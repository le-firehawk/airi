import type { Rectangle } from 'electron'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveStageWindowBounds, restoreStageWindowBounds, StageWindowSize } from './stage-size'

const desktop = vi.hoisted(() => ({
  workArea: { x: -1920, y: -200, width: 1920, height: 1040 },
  primary: { x: 0, y: 25, width: 1440, height: 875 },
  getDisplayMatching: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { commandLine: { getSwitchValue: () => 'x11' } },
  screen: {
    getDisplayMatching: desktop.getDisplayMatching,
    getPrimaryDisplay: () => ({ workArea: desktop.primary, scaleFactor: 2 }),
  },
}))

function createWindow(initial = { x: -1800, y: -100, width: 450, height: 600 }) {
  let bounds = { ...initial }
  return {
    getBounds: () => ({ ...bounds }),
    setBounds: vi.fn((next: Partial<Rectangle>) => { bounds = { ...bounds, ...next } }),
    setSize: vi.fn((width: number, height: number) => { bounds = { ...bounds, width, height } }),
    setMinimumSize: vi.fn(),
    setMaximumSize: vi.fn(),
    webContents: { getZoomFactor: () => 1.25 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  desktop.workArea = { x: -1920, y: -200, width: 1920, height: 1040 }
  desktop.getDisplayMatching.mockImplementation(() => ({ workArea: desktop.workArea, scaleFactor: 2 }))
})

describe('stage bounds recovery', () => {
  it('restores an offscreen window into a negative-origin display without changing its size', () => {
    expect(resolveStageWindowBounds({ x: 4000, y: -9000, width: 450, height: 600 }, desktop.workArea))
      .toEqual({ x: -450, y: -200, width: 450, height: 600 })
  })

  it('replaces invalid saved values and returns integer logical pixels', () => {
    const bounds = resolveStageWindowBounds({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: -1, height: Number.NaN }, desktop.workArea)
    expect(bounds).toEqual({ x: -1185, y: 20, width: 450, height: 600 })
    expect(resolveStageWindowBounds({ x: -1750.2, y: -100.4, width: 599.6, height: 750.2 }, desktop.workArea))
      .toEqual({ x: -1750, y: -100, width: 600, height: 750 })
  })

  it('keeps tiny screens usable instead of enforcing a minimum larger than their work area', () => {
    expect(resolveStageWindowBounds({ width: 1, height: 1 }, { x: -200, y: 30, width: 200, height: 240 }))
      .toEqual({ x: -200, y: 30, width: 200, height: 240 })
  })

  it('clamps oversized saved windows to the usable area without covering system panels', () => {
    expect(resolveStageWindowBounds({ x: -2000, y: -300, width: 9000, height: 9000 }, desktop.workArea))
      .toEqual(desktop.workArea)
  })
})

describe('saved stage display selection', () => {
  const primary = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } }
  const secondary = { bounds: { x: -1920, y: -200, width: 1920, height: 1080 }, workArea: { x: -1920, y: -200, width: 1920, height: 1040 } }

  it('preserves a window on its negative-origin secondary display', () => {
    expect(restoreStageWindowBounds({ x: -1200, y: -100, width: 450, height: 600 }, [primary, secondary], primary))
      .toEqual({ x: -1200, y: -100, width: 450, height: 600 })
  })

  it('selects the display that owns most of a cross-display window', () => {
    expect(restoreStageWindowBounds({ x: -100, y: 30, width: 500, height: 600 }, [secondary, primary], primary))
      .toEqual({ x: 0, y: 30, width: 500, height: 600 })
  })

  it('recovers huge finite or disconnected coordinates on the primary display', () => {
    expect(restoreStageWindowBounds({ x: 1e100, y: -1e100, width: 450, height: 600 }, [secondary, primary], primary))
      .toEqual({ x: 990, y: 25, width: 450, height: 600 })
    expect(restoreStageWindowBounds({ x: -1200, y: -100, width: 450, height: 600 }, [primary], primary))
      .toEqual({ x: 0, y: 25, width: 450, height: 600 })
    expect(desktop.getDisplayMatching).not.toHaveBeenCalled()
  })
})

describe('manual stage resizing', () => {
  it('resizes the real window and returns accepted native dimensions', () => {
    const window = createWindow()
    const size = new StageWindowSize(window, false)
    const state = size.resize({ width: 960, height: 720 })
    expect(window.setBounds).toHaveBeenCalledWith({ x: -1800, y: -100, width: 960, height: 720 })
    expect(state.width).toBe(960)
    expect(state.height).toBe(720)
    expect(state.zoomFactor).toBe(1.25)
  })

  it('uses logical work-area bounds without multiplying HiDPI display scale', () => {
    const window = createWindow()
    const size = new StageWindowSize(window, false)
    size.resize({ width: 4000, height: 4000 })
    expect(window.setMaximumSize).toHaveBeenCalledWith(1920, 1040)
    expect(window.getBounds()).toEqual(desktop.workArea)
  })

  it('applies a usable minimum and preserves the current top-left corner', () => {
    const window = createWindow()
    const size = new StageWindowSize(window, false)
    size.resize({ width: 5, height: 2 })
    expect(window.setMinimumSize).toHaveBeenCalledWith(280, 320)
    expect(window.getBounds()).toEqual({ x: -1800, y: -100, width: 280, height: 320 })
  })

  it.each([
    { width: Number.NaN, height: 400 },
    { width: Number.POSITIVE_INFINITY, height: 400 },
    { width: 450, height: Number.NEGATIVE_INFINITY },
    { width: 0, height: 400 },
    { width: 450, height: -1 },
  ])('rejects invalid resize requests before a native mutation: %s', (request) => {
    const window = createWindow()
    const size = new StageWindowSize(window, false)
    expect(() => size.resize(request)).toThrow()
    expect(window.setBounds).not.toHaveBeenCalled()
    expect(window.setSize).not.toHaveBeenCalled()
    expect(window.setMinimumSize).not.toHaveBeenCalled()
  })

  it('uses size-only requests on native Wayland without assuming reported window coordinates are real', () => {
    const window = createWindow({ x: 0, y: 0, width: 450, height: 600 })
    const size = new StageWindowSize(window, true)
    const result = size.resize({ width: 5000, height: 3000 })
    expect(window.setSize).toHaveBeenCalledWith(1440, 875)
    expect(window.setBounds).not.toHaveBeenCalled()
    expect(desktop.getDisplayMatching).not.toHaveBeenCalled()
    expect(result.wayland).toBe(true)
    expect(result.width).toBe(1440)
  })

  it('reports an unchanged native size when a Wayland compositor rejects the request', () => {
    const window = createWindow()
    window.setSize.mockImplementation(() => {})
    const size = new StageWindowSize(window, true)
    expect(size.resize({ width: 900, height: 720 }).width).toBe(450)
  })

  it('updates constraints after display changes and recovers an offscreen window', () => {
    const window = createWindow()
    const size = new StageWindowSize(window, false)
    size.refreshConstraints()
    desktop.workArea = { x: 0, y: 30, width: 1280, height: 690 }
    size.refreshConstraints(true)
    expect(window.setMaximumSize).toHaveBeenLastCalledWith(1280, 690)
    expect(window.getBounds()).toEqual({ x: 0, y: 30, width: 450, height: 600 })
  })

  it('does not repeatedly apply identical native constraints during a drag', () => {
    const window = createWindow()
    const size = new StageWindowSize(window, false)
    size.refreshConstraints()
    size.resize({ width: 600, height: 650 })
    size.resize({ width: 650, height: 700 })
    expect(window.setMinimumSize).toHaveBeenCalledTimes(1)
    expect(window.setMaximumSize).toHaveBeenCalledTimes(1)
  })
})
