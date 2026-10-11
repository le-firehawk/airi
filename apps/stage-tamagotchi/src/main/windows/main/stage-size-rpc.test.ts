import type { ElectronMainContextExtensions, ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'
import type { IpcMainEvent, Rectangle } from 'electron'

import { createContext, defineInvoke } from '@moeru/eventa'
import { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { stageWindowGetSize, stageWindowSetSize } from '../../../shared/eventa/stage-window'
import { setupStageWindowSize } from './stage-size'

const desktop = vi.hoisted(() => ({
  listeners: new Map<string, Set<() => void>>(),
  nextWindowId: 1,
  workArea: { x: 0, y: 25, width: 1440, height: 875 },
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    BrowserWindow: class extends EventEmitter {
      private bounds = { x: 100, y: 100, width: 450, height: 600 }
      private destroyed = false
      webContents = { id: desktop.nextWindowId++, getZoomFactor: () => 1 }
      isDestroyed = () => this.destroyed
      getBounds = () => ({ ...this.bounds })
      setBounds = vi.fn((next: Partial<Rectangle>) => { this.bounds = { ...this.bounds, ...next } })
      setSize = vi.fn((width: number, height: number) => { this.bounds = { ...this.bounds, width, height } })
      setMinimumSize = vi.fn()
      setMaximumSize = vi.fn()
      destroy() {
        this.destroyed = true
        this.emit('closed')
      }
    },
    app: { commandLine: { getSwitchValue: () => 'x11' } },
    screen: {
      getDisplayMatching: () => ({ workArea: desktop.workArea }),
      getPrimaryDisplay: () => ({ workArea: desktop.workArea }),
      on: (event: string, listener: () => void) => {
        if (!desktop.listeners.has(event))
          desktop.listeners.set(event, new Set())
        desktop.listeners.get(event)!.add(listener)
      },
      off: (event: string, listener: () => void) => desktop.listeners.get(event)?.delete(listener),
    },
  }
})

function createWindow(id: number) {
  desktop.nextWindowId = id
  const window = new BrowserWindow()
  return { window, native: window, close: () => window.destroy() }
}

function sender(id: number) {
  return { raw: { ipcMainEvent: { sender: { id } } as IpcMainEvent, event: undefined } }
}

function displayListenerCount() {
  return [...desktop.listeners.values()].reduce((count, listeners) => count + listeners.size, 0)
}

beforeEach(() => {
  desktop.listeners.clear()
  desktop.workArea = { x: 0, y: 25, width: 1440, height: 875 }
})

describe('stage size Electron command ownership', () => {
  it('rejects foreign senders and permits only the intended window', async () => {
    const context = createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>()
    const stage = createWindow(1)
    setupStageWindowSize(context, stage.window)
    const resize = defineInvoke(context, stageWindowSetSize)
    const read = defineInvoke(context, stageWindowGetSize)
    await expect(resize({ width: 900, height: 720 }, sender(99))).rejects.toThrow('another window')
    await expect(read(undefined, sender(99))).rejects.toThrow('another window')
    expect(stage.native.setBounds).not.toHaveBeenCalled()
    const accepted = await resize({ width: 900, height: 720 }, sender(1))
    expect(accepted.width).toBe(900)
    expect(stage.native.setBounds).toHaveBeenCalledTimes(1)
    expect((await read(undefined, sender(1))).height).toBe(720)
    stage.close()
    expect(displayListenerCount()).toBe(0)
  })

  it('removes display listeners and old invokes before a replacement session starts', async () => {
    const context = createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>()
    const first = createWindow(1)
    setupStageWindowSize(context, first.window)
    expect(displayListenerCount()).toBe(3)
    expect(first.window.listenerCount('move')).toBe(1)
    expect(first.window.listenerCount('closed')).toBe(1)
    first.close()
    expect(displayListenerCount()).toBe(0)
    expect(first.window.listenerCount('move')).toBe(0)
    expect(first.window.listenerCount('closed')).toBe(0)

    // Reusing the context catches stale handlers: an old handler rejects the new sender or mutates the closed window.
    const second = createWindow(2)
    setupStageWindowSize(context, second.window)
    expect(displayListenerCount()).toBe(3)
    const result = await defineInvoke(context, stageWindowSetSize)({ width: 700, height: 700 }, sender(2))
    expect(result.width).toBe(700)
    expect(first.native.setBounds).not.toHaveBeenCalled()
    expect(second.native.setBounds).toHaveBeenCalledTimes(1)
    expect((await defineInvoke(context, stageWindowGetSize)(undefined, sender(2))).height).toBe(700)
    second.close()
    expect(displayListenerCount()).toBe(0)
  })

  it('keeps a second live owner usable after the first window closes', async () => {
    const firstContext = createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>()
    const secondContext = createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>()
    const first = createWindow(1)
    const second = createWindow(2)
    setupStageWindowSize(firstContext, first.window)
    setupStageWindowSize(secondContext, second.window)
    expect(displayListenerCount()).toBe(6)
    first.close()
    expect(displayListenerCount()).toBe(3)
    desktop.workArea = { x: -1280, y: 0, width: 1280, height: 690 }
    for (const listener of desktop.listeners.get('display-removed') ?? [])
      listener()
    expect(first.native.setBounds).not.toHaveBeenCalled()
    expect(second.native.setBounds).toHaveBeenCalledWith({ x: -450, y: 90, width: 450, height: 600 })
    const state = await defineInvoke(secondContext, stageWindowSetSize)({ width: 800, height: 650 }, sender(2))
    expect(state.width).toBe(800)
    expect(state.maxHeight).toBe(690)
    second.close()
    expect(displayListenerCount()).toBe(0)
  })
})
