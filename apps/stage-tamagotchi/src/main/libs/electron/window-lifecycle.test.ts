import type { IpcMain } from 'electron'

import { EventEmitter } from 'node:events'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { onWindowClosed } from './window-lifecycle'

const diagnostics = vi.hoisted(() => ({ withError: vi.fn(), error: vi.fn() }))
vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({ useGlobalConfig: () => ({
    withError: diagnostics.withError.mockReturnValue({ error: diagnostics.error }),
  }) }),
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    BrowserWindow: class extends EventEmitter {
      readonly webContents = { id: 1, isDestroyed: () => false, send: vi.fn() }
      isDestroyed() { return false }
    },
  }
})

beforeEach(() => {
  diagnostics.withError.mockClear()
  diagnostics.error.mockClear()
})

describe('window cleanup ownership', () => {
  it('uses one native listener for independent registrations and runs each only once', () => {
    const window = new BrowserWindow()
    const callback = vi.fn()
    const unregister = Array.from({ length: 20 }, () => onWindowClosed(window, callback))
    expect(window.getMaxListeners()).toBe(10)
    expect(window.listenerCount('closed')).toBe(1)
    unregister[0]()
    unregister[0]()
    window.emit('closed')
    window.emit('closed')
    expect(callback).toHaveBeenCalledTimes(19)
    expect(window.listenerCount('closed')).toBe(0)
    unregister.forEach(remove => remove())
  })

  it('detaches empty owners without letting stale unregister calls detach a new owner', () => {
    const window = new BrowserWindow()
    const removed = vi.fn()
    const remove = onWindowClosed(window, removed)
    remove()
    expect(window.listenerCount('closed')).toBe(0)
    const next = vi.fn()
    const last = vi.fn()
    onWindowClosed(window, next)
    remove()
    onWindowClosed(window, last)
    expect(window.listenerCount('closed')).toBe(1)
    window.emit('closed')
    expect(removed).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
    expect(last).toHaveBeenCalledOnce()
  })

  it('keeps the close snapshot and immediately runs registrations made during or after closure', () => {
    const window = new BrowserWindow()
    const calls: string[] = []
    let removeLater = () => {}
    onWindowClosed(window, () => {
      calls.push('first')
      removeLater()
      const removeDuring = onWindowClosed(window, () => {
        calls.push('during')
      })
      removeDuring()
      window.emit('closed')
    })
    removeLater = onWindowClosed(window, () => {
      calls.push('later')
    })
    window.emit('closed')
    // Electron's closed event is authoritative, independent of isDestroyed timing.
    expect(window.isDestroyed()).toBe(false)
    const removeAfter = onWindowClosed(window, () => {
      calls.push('after')
    })
    removeAfter()
    expect(calls).toEqual(['first', 'during', 'later', 'after'])
    expect(window.listenerCount('closed')).toBe(0)
  })

  it('immediately cleans up an already-destroyed window without adding a listener', () => {
    const window = new BrowserWindow()
    vi.spyOn(window, 'isDestroyed').mockReturnValue(true)
    const callback = vi.fn()
    const remove = onWindowClosed(window, callback)
    remove()
    expect(callback).toHaveBeenCalledOnce()
    expect(window.listenerCount('closed')).toBe(0)
  })

  it('reports all synchronous failures and preserves later cleanup and native Eventa disposal', () => {
    const window = new BrowserWindow()
    const ipcMain = new EventEmitter() as IpcMain
    const first = new Error('first cleanup')
    const second = new Error('second cleanup')
    onWindowClosed(window, () => {
      throw first
    })
    onWindowClosed(window, () => {
      throw second
    })
    const later = vi.fn()
    onWindowClosed(window, later)
    createContext(ipcMain, window, { onlySameWindow: true })
    expect(ipcMain.listenerCount('eventa-message')).toBe(1)

    expect(() => window.emit('closed')).not.toThrow()

    expect(later).toHaveBeenCalledOnce()
    expect(ipcMain.listenerCount('eventa-message')).toBe(0)
    expect(ipcMain.listenerCount('eventa-error')).toBe(0)
    expect(diagnostics.withError).toHaveBeenCalledOnce()
    expect(diagnostics.withError.mock.calls[0][0]).toBeInstanceOf(AggregateError)
    expect(diagnostics.withError.mock.calls[0][0].errors).toEqual([first, second])
    expect(diagnostics.withError.mock.calls[0][0].cause).toEqual([first, second])
    expect(diagnostics.error).toHaveBeenCalledOnce()
  })

  it('reports rejected async cleanup without delaying other callbacks', async () => {
    const window = new BrowserWindow()
    const failure = new Error('async cleanup')
    const pending = Promise.withResolvers<void>()
    onWindowClosed(window, () => pending.promise)
    const later = vi.fn()
    onWindowClosed(window, later)
    window.emit('closed')
    expect(later).toHaveBeenCalledOnce()
    pending.reject(failure)
    await Promise.resolve()
    expect(diagnostics.withError.mock.calls[0][0].errors).toEqual([failure])
    expect(diagnostics.error).toHaveBeenCalledOnce()
  })

  it('isolates owners when one window closes and another stays open', () => {
    const first = new BrowserWindow()
    const second = new BrowserWindow()
    const firstCleanup = vi.fn()
    const secondCleanup = vi.fn()
    onWindowClosed(first, firstCleanup)
    onWindowClosed(second, secondCleanup)
    first.emit('closed')
    expect(firstCleanup).toHaveBeenCalledOnce()
    expect(secondCleanup).not.toHaveBeenCalled()
    expect(second.listenerCount('closed')).toBe(1)
    second.emit('closed')
    expect(secondCleanup).toHaveBeenCalledOnce()
  })
})
