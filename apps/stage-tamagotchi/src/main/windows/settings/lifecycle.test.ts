import type { BrowserWindow as ElectronWindow, Rectangle } from 'electron'

import { EventEmitter } from 'node:events'

import { defineInvoke, defineInvokeEventa } from '@moeru/eventa'
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { initScreenCaptureForMain, initScreenCaptureForWindow } from '@proj-airi/electron-screen-capture/main'
import { BrowserWindow, ipcMain, powerMonitor, screen } from 'electron'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { setupSettingsWindowReusableFunc } from '.'
import { defaultDesktopCompanionState } from '../../../shared/desktop-companion'
import { i18nGetLocale } from '../../../shared/eventa'
import { emitAppBeforeQuit, emitAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { onWindowClosed } from '../../libs/electron/window-lifecycle'
import { createServerChannelService } from '../../services/airi/channel-server'
import { IOTraceRecordingService } from '../../services/airi/io-trace-recording'
import { DesktopNotificationCenter } from '../../services/electron/desktop-notifications'
import { setupGlobalShortcutService } from '../../services/electron/global-shortcut'
import { setupMainWindowElectronInvokes } from '../main/rpc/index.electron'
import { setupSettingsWindowInvokes } from './rpc/index.electron'

const boundary = vi.hoisted(() => ({
  resolve: vi.fn(),
  windows: [] as ElectronWindow[],
}))

vi.mock('injeca', () => ({ injeca: { resolve: boundary.resolve } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('~build/git', () => ({ committerDate: '2026-04-01T00:00:00.000Z' }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const display = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 30, width: 1920, height: 1050 },
    scaleFactor: 1,
  }
  let id = 0
  class Window extends EventEmitter {
    readonly id = ++id
    private destroyed = false
    private bounds = { x: 100, y: 100, width: 450, height: 600 }
    readonly webContents = Object.assign(new EventEmitter(), {
      id: this.id,
      isDestroyed: () => this.destroyed,
      isCrashed: () => false,
      send: vi.fn(),
      getZoomFactor: () => 1,
      setWindowOpenHandler: vi.fn(),
      getURL: () => 'file:///airi/index.html',
    })

    constructor() {
      super()
      boundary.windows.push(this as never)
    }

    isDestroyed() { return this.destroyed }
    isVisible() { return false }
    getTitle() { return 'Settings' }
    getBounds = () => ({ ...this.bounds })
    getSize = () => [this.bounds.width, this.bounds.height]
    setBounds = vi.fn((bounds: Partial<Rectangle>) => { this.bounds = { ...this.bounds, ...bounds } })
    setSize = vi.fn((width: number, height: number) => { this.bounds = { ...this.bounds, width, height } })
    setMinimumSize = vi.fn()
    setMaximumSize = vi.fn()
    loadFile = vi.fn().mockResolvedValue(undefined)
    close() {
      this.destroyed = true
      this.emit('closed')
      this.webContents.emit('destroyed')
    }
  }
  return {
    BrowserWindow: Window,
    ipcMain: new EventEmitter(),
    powerMonitor: new EventEmitter(),
    screen: Object.assign(new EventEmitter(), {
      getAllDisplays: () => [display],
      getDisplayMatching: () => display,
      getPrimaryDisplay: () => display,
    }),
    app: {
      isPackaged: true,
      getPath: () => '/tmp/airi-window-lifecycle',
      getVersion: () => '0.12.0',
      commandLine: {
        getSwitchValue: () => 'x11',
        hasSwitch: () => false,
        appendSwitch: vi.fn(),
      },
    },
    Notification: { isSupported: () => false },
    shell: { openExternal: vi.fn() },
    systemPreferences: {},
    desktopCapturer: {},
    session: { defaultSession: {} },
    globalShortcut: { unregisterAll: vi.fn() },
  }
})

type SettingsParams = Parameters<typeof setupSettingsWindowReusableFunc>[0]

function setup() {
  const center = new DesktopNotificationCenter({
    load: defaultDesktopCompanionState,
    save: vi.fn(),
  }, { supported: () => false, show: vi.fn() })
  const subscriptions = new Set<() => void>()
  const subscribe = () => {
    const unsubscribe = vi.fn(() => {
      subscriptions.delete(unsubscribe)
    })
    subscriptions.add(unsubscribe)
    return unsubscribe
  }
  boundary.resolve.mockResolvedValue({ center, config: { get: () => ({ language: 'en' }) } })
  const params: SettingsParams = {
    widgetsManager: {
      getWindow: vi.fn(),
      openWindow: vi.fn(),
      pushWidget: vi.fn(),
      updateWidget: vi.fn(),
      removeWidget: vi.fn(),
      clearWidgets: vi.fn(),
      hideWindow: vi.fn(),
      getWidgetSnapshot: vi.fn(),
      publishWidgetEvent: vi.fn(),
      onWidgetEvent: vi.fn(),
      requestWidgetIframe: vi.fn(),
      publishWidgetIframeRequestResult: vi.fn(),
      prepareWidgetWindow: vi.fn(),
    },
    autoUpdater: {
      state: { status: 'idle' },
      subscribe,
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      getPreferredUpdateLane: vi.fn(),
      setPreferredUpdateLane: vi.fn(),
    },
    devtoolsWindow: { openWindow: vi.fn() },
    serverChannel: {} as SettingsParams['serverChannel'],
    godotStageManager: {
      subscribe,
      subscribeViewError: subscribe,
      subscribeViewSnapshot: subscribe,
      applySceneInput: vi.fn(),
      applyViewPatch: vi.fn(),
      getStatus: vi.fn(),
      getViewSnapshot: vi.fn(),
      requestViewSnapshot: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    },
    mcpManager: {
      ensureConfigFile: vi.fn(),
      openConfigFile: vi.fn(),
      applyAndRestart: vi.fn(),
      listTools: vi.fn(),
      callTool: vi.fn(),
      stopAll: vi.fn(),
      getRuntimeStatus: vi.fn(),
      readConfigText: vi.fn(),
      writeConfigText: vi.fn(),
      testServer: vi.fn(),
    },
    i18n: { locale: vi.fn(), t: vi.fn() },
    globalShortcut: setupGlobalShortcutService(),
    spotlightWindow: { show: vi.fn(), getShortcutAccelerator: vi.fn(), updateShortcutAccelerator: vi.fn() },
    ioTraceRecording: new IOTraceRecordingService({
      directory: '/tmp/airi-window-lifecycle',
      getStoredEnabled: () => false,
      setStoredEnabled: vi.fn(),
    }),
    onWindowCreated: (window: ElectronWindow) => { onWindowClosed(window, vi.fn()) },
  }
  return { center, subscriptions, params }
}

beforeAll(async () => {
  initScreenCaptureForMain()
  // The server channel owns one app-wide adapter, independent of window lifetimes.
  await createServerChannelService({ serverChannel: {} as never })
})

describe('main and settings window cleanup at the Electron boundary', () => {
  // https://github.com/le-firehawk/airi/actions/runs/38105561839
  // ROOT CAUSE:
  // Independent base-service listeners pushed complete Settings setup to 19 closed listeners.
  // A shared cleanup owner preserves every teardown operation with one native listener.
  it('keeps complete window setup below the default closed-listener limit', async () => {
    const { center, params } = setup()
    const settings = setupSettingsWindowReusableFunc(params)
    const window = await settings.getWindow()
    try {
      expect(window).toBeInstanceOf(BrowserWindow)
      expect(window.getMaxListeners()).toBe(10)
      expect(window.listenerCount('closed')).toBe(8)
      // Extension directory import can add one more owner after Settings opens.
      window.once('closed', vi.fn())
      expect(window.listenerCount('closed')).toBeLessThan(window.getMaxListeners())
    }
    finally {
      window.close()
      center.dispose()
      params.globalShortcut.dispose()
    }
  })

  it('returns owned subscriptions and IPC listeners to baseline across repeated window creation', async () => {
    const { center, subscriptions, params } = setup()
    const settings = setupSettingsWindowReusableFunc(params)
    const ipcBaseline = ipcMain.listenerCount('eventa-message')
    const errorBaseline = ipcMain.listenerCount('eventa-error')
    try {
      for (let cycle = 0; cycle < 4; cycle++) {
        const window = await settings.getWindow()
        expect(window.listenerCount('closed')).toBeLessThan(10)
        expect(subscriptions.size).toBe(4)
        expect(powerMonitor.listenerCount('suspend')).toBe(1)
        expect(screen.listenerCount('display-added')).toBe(1)
        window.close()
        expect(subscriptions.size).toBe(0)
        for (const event of ['suspend', 'resume', 'lock-screen', 'unlock-screen'])
          expect(powerMonitor.listenerCount(event)).toBe(0)
        for (const event of ['display-added', 'display-removed', 'display-metrics-changed'])
          expect(screen.listenerCount(event)).toBe(0)
        expect(ipcMain.listenerCount('eventa-message')).toBe(ipcBaseline)
        expect(ipcMain.listenerCount('eventa-error')).toBe(errorBaseline)

        vi.mocked(window.webContents.send).mockClear()
        center.updatePreferences({ pulsingBorder: cycle % 2 === 0 })
        await params.ioTraceRecording.setEnabled(false)
        await emitAppWindowAllClosed()
        await emitAppBeforeQuit()
        expect(window.webContents.send).not.toHaveBeenCalled()
      }
    }
    finally {
      for (const window of boundary.windows) {
        if (!window.isDestroyed())
          window.close()
      }
      center.dispose()
      params.globalShortcut.dispose()
    }
  })

  it('keeps main-window services, screen capture, and native dragging below the close-listener limit', async () => {
    const { center, params } = setup()
    const window = new BrowserWindow()
    const stopChatState = vi.fn()
    const ipcBaseline = ipcMain.listenerCount('eventa-message')
    const displayEvents = ['display-added', 'display-removed', 'display-metrics-changed']
    const displayBaselines = displayEvents.map(event => screen.listenerCount(event))
    const moveBaseline = window.listenerCount('move')
    try {
      await setupMainWindowElectronInvokes({
        ...params,
        window,
        editorWindow: { getWindow: vi.fn(), openWindow: vi.fn() },
        settingsWindow: { getWindow: vi.fn(), openWindow: vi.fn() },
        chatWindow: { open: vi.fn(), toggle: vi.fn(), getButtonState: vi.fn(), onButtonStateChange: () => stopChatState },
        noticeWindow: { open: vi.fn() },
        onboardingWindowManager: { getWindow: vi.fn(), getAndToggleWindow: vi.fn(), onClosed: vi.fn() },
        inlayWindow: vi.fn(),
      })
      initScreenCaptureForWindow(window)
      expect(window.setMinimumSize).toHaveBeenCalledWith(280, 320)
      expect(window.setMaximumSize).toHaveBeenCalledWith(1920, 1050)
      expect(window.listenerCount('move')).toBeGreaterThan(moveBaseline)
      for (const [index, event] of displayEvents.entries())
        expect(screen.listenerCount(event)).toBeGreaterThan(displayBaselines[index])
      expect(window.listenerCount('closed')).toBe(7)
      // Non-Linux main windows also remove their native dragging invoke handler on close.
      window.on('closed', vi.fn())
      expect(window.listenerCount('closed')).toBe(8)
      expect(window.getMaxListeners()).toBe(10)
      window.close()
      expect(stopChatState).toHaveBeenCalledOnce()
      expect(ipcMain.listenerCount('eventa-message')).toBe(ipcBaseline)
      expect(window.listenerCount('move')).toBe(moveBaseline)
      for (const [index, event] of displayEvents.entries())
        expect(screen.listenerCount(event)).toBe(displayBaselines[index])
    }
    finally {
      if (!window.isDestroyed())
        window.close()
      center.dispose()
      params.globalShortcut.dispose()
    }
  })

  it('disposes only the closed window adapter while another window keeps its pending work and IPC routing', async () => {
    const { center, params } = setup()
    const first = new BrowserWindow()
    const second = new BrowserWindow()
    const ipcBaseline = ipcMain.listenerCount('eventa-message')
    const errorBaseline = ipcMain.listenerCount('eventa-error')
    const firstContext = await setupSettingsWindowInvokes({ ...params, settingsWindow: first })
    const secondContext = await setupSettingsWindowInvokes({ ...params, settingsWindow: second })
    const received = new EventEmitter()
    vi.mocked(second.webContents.send).mockImplementation((name, ...args) => {
      received.emit(name, {}, ...args)
    })
    const renderer = createRendererContext({
      on: received.on.bind(received),
      removeListener: received.removeListener.bind(received),
      send: (name: string, ...args: unknown[]) => { ipcMain.emit(name, { sender: second.webContents }, ...args) },
    } as never)
    try {
      expect(ipcMain.listenerCount('eventa-message')).toBe(ipcBaseline + 4)
      const request = defineInvokeEventa<void>('test:window-cleanup:pending')
      const firstPending = defineInvoke(firstContext, request)()
      const firstRejected = expect(firstPending).rejects.toThrow('electron main ipc disposed')
      const secondPending = defineInvoke(secondContext, request)()
      const secondRejected = expect(secondPending).rejects.toThrow('electron main ipc disposed')
      const secondSettled = vi.fn()
      void secondPending.then(secondSettled, secondSettled)

      first.close()
      await firstRejected
      expect(secondSettled).not.toHaveBeenCalled()
      expect(ipcMain.listenerCount('eventa-message')).toBe(ipcBaseline + 2)
      expect(ipcMain.listenerCount('eventa-error')).toBe(errorBaseline + 2)
      await expect(defineInvoke(renderer.context, i18nGetLocale)()).resolves.toBe('en')
      expect(second.webContents.send).toHaveBeenCalled()

      second.close()
      await secondRejected
      expect(ipcMain.listenerCount('eventa-message')).toBe(ipcBaseline)
      expect(ipcMain.listenerCount('eventa-error')).toBe(errorBaseline)
    }
    finally {
      if (!first.isDestroyed())
        first.close()
      if (!second.isDestroyed())
        second.close()
      renderer.dispose()
      center.dispose()
      params.globalShortcut.dispose()
    }
  })
})
