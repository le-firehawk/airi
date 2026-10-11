import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, Rectangle, WebContents } from 'electron'

import type { StageWindowSizeState } from '../../../shared/eventa/stage-window'
import type { DisplayArea } from '../../../shared/utils/electron/display'

import { env } from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, screen } from 'electron'
import { finite, minValue, number, object, parse, pipe } from 'valibot'

import { stageWindowGetSize, stageWindowSetSize } from '../../../shared/eventa/stage-window'
import { clampBoundsWithinRect, findDominantDisplayArea } from '../../../shared/utils/electron/display'
import { resolveIsWayland } from '../../app/ozone'
import { onWindowClosed } from '../../libs/electron/window-lifecycle'

const sizeSchema = object({
  width: pipe(number(), finite(), minValue(1)),
  height: pipe(number(), finite(), minValue(1)),
})

function sizeLimits(workArea: Rectangle) {
  return {
    minWidth: Math.min(280, workArea.width),
    minHeight: Math.min(320, workArea.height),
    maxWidth: workArea.width,
    maxHeight: workArea.height,
  }
}

/**
 * Restores a usable stage after saved bounds become invalid or a display disappears.
 * All rectangles use Electron logical display pixels. Display scale never multiplies these values.
 *
 * @example
 * resolveStageWindowBounds({ width: -1, height: 600, x: -9000, y: 0 }, { x: 0, y: 0, width: 1920, height: 1080 })
 * // => { x: 0, y: 0, width: 450, height: 600 }
 */
export function resolveStageWindowBounds(saved: Partial<Rectangle>, workArea: Rectangle): Rectangle {
  const limits = sizeLimits(workArea)
  const width = Number.isFinite(saved.width) && saved.width! > 0 ? saved.width! : 450
  const height = Number.isFinite(saved.height) && saved.height! > 0 ? saved.height! : 600
  return clampBoundsWithinRect({
    x: Number.isFinite(saved.x) ? Math.round(saved.x!) : workArea.x + Math.round((workArea.width - width) / 2),
    y: Number.isFinite(saved.y) ? Math.round(saved.y!) : workArea.y + Math.round((workArea.height - height) / 2),
    width: Math.max(limits.minWidth, Math.round(width)),
    height: Math.max(limits.minHeight, Math.round(height)),
  }, workArea)
}

/**
 * Selects the saved window's dominant display without sending untrusted coordinates to native screen APIs.
 * Disconnected or invalid display positions recover on the primary display.
 *
 * @example
 * restoreStageWindowBounds({ x: 1e100, width: 900 }, [primary], primary)
 * // Returns a 900-pixel-wide window inside the primary work area.
 */
export function restoreStageWindowBounds(saved: Partial<Rectangle>, displays: readonly DisplayArea[], primary: DisplayArea): Rectangle {
  const candidate = {
    x: Number.isFinite(saved.x) ? saved.x! : primary.workArea.x,
    y: Number.isFinite(saved.y) ? saved.y! : primary.workArea.y,
    width: Number.isFinite(saved.width) && saved.width! > 0 ? saved.width! : 450,
    height: Number.isFinite(saved.height) && saved.height! > 0 ? saved.height! : 600,
  }
  const display = findDominantDisplayArea(candidate, displays)
  const overlaps = display
    && candidate.x < display.bounds.x + display.bounds.width
    && candidate.x + candidate.width > display.bounds.x
    && candidate.y < display.bounds.y + display.bounds.height
    && candidate.y + candidate.height > display.bounds.y
  return resolveStageWindowBounds(saved, overlaps ? display.workArea : primary.workArea)
}

type StageWindow = Pick<BrowserWindow, 'getBounds' | 'setBounds' | 'setSize' | 'setMinimumSize' | 'setMaximumSize'> & { webContents: Pick<WebContents, 'getZoomFactor'> }

/** Owns validated manual stage resizing. The existing main-window resize listener persists accepted native bounds. */
export class StageWindowSize {
  private appliedLimits?: ReturnType<typeof sizeLimits>

  constructor(private readonly window: StageWindow, private readonly wayland: boolean) {}

  private workArea() {
    // Wayland cannot report the window origin. Do not infer a monitor from its synthetic (0, 0).
    return this.wayland ? screen.getPrimaryDisplay().workArea : screen.getDisplayMatching(this.window.getBounds()).workArea
  }

  snapshot(): StageWindowSizeState {
    const { width, height } = this.window.getBounds()
    return { width, height, ...sizeLimits(this.workArea()), zoomFactor: this.window.webContents.getZoomFactor(), wayland: this.wayland }
  }

  refreshConstraints(recoverPosition = false) {
    const workArea = this.workArea()
    const limits = sizeLimits(workArea)
    const previous = this.appliedLimits
    if (!previous || Object.entries(limits).some(([key, value]) => previous[key as keyof typeof limits] !== value)) {
      // Cache before native calls, which can synchronously emit another move or resize.
      this.appliedLimits = limits
      this.window.setMinimumSize(limits.minWidth, limits.minHeight)
      this.window.setMaximumSize(limits.maxWidth, limits.maxHeight)
    }
    if (recoverPosition && !this.wayland)
      this.window.setBounds(resolveStageWindowBounds(this.window.getBounds(), workArea))
  }

  resize(input: { width: number, height: number }): StageWindowSizeState {
    const size = parse(sizeSchema, input)
    this.refreshConstraints()
    const bounds = resolveStageWindowBounds({ ...this.window.getBounds(), ...size }, this.workArea())
    if (this.wayland) {
      // setBounds also requests positioning. Native Wayland allows only the compositor to place windows.
      this.window.setSize(bounds.width, bounds.height)
    }
    else {
      this.window.setBounds(bounds)
    }
    return this.snapshot()
  }
}

/** Registers main-window-only commands and releases display listeners when that window closes. */
export function setupStageWindowSize(context: ReturnType<typeof createContext>['context'], window: BrowserWindow) {
  const size = new StageWindowSize(window, resolveIsWayland({
    explicitOzonePlatform: app.commandLine.getSwitchValue('ozone-platform'),
    ozonePlatformHint: app.commandLine.getSwitchValue('ozone-platform-hint'),
    env,
  }))
  size.refreshConstraints()
  const moved = () => size.refreshConstraints()
  const displaysChanged = () => size.refreshConstraints(true)
  window.on('move', moved)
  screen.on('display-added', displaysChanged)
  screen.on('display-removed', displaysChanged)
  screen.on('display-metrics-changed', displaysChanged)
  const getSize = defineInvokeHandler(context, stageWindowGetSize, (_, options) => {
    if (options?.raw.ipcMainEvent.sender.id !== window.webContents.id)
      throw new Error('Stage size request came from another window')
    return size.snapshot()
  })
  const setSize = defineInvokeHandler(context, stageWindowSetSize, (input, options) => {
    if (options?.raw.ipcMainEvent.sender.id !== window.webContents.id)
      throw new Error('Stage resize request came from another window')
    return size.resize(input)
  })
  onWindowClosed(window, () => {
    getSize()
    setSize()
    window.off('move', moved)
    screen.off('display-added', displaysChanged)
    screen.off('display-removed', displaysChanged)
    screen.off('display-metrics-changed', displaysChanged)
  })
}
