import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MockAutoUpdater } from './mock-auto-updater'

vi.mock('electron', () => ({ app: { quit: vi.fn() } }))

describe('development auto updater', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('emits the checking and available events around the simulated delay', async () => {
    const updater = new MockAutoUpdater()
    const checking = vi.fn()
    const available = vi.fn()
    updater.on('checking-for-update', checking)
    updater.on('update-available', available)

    const result = updater.checkForUpdates()

    expect(checking).toHaveBeenCalledOnce()
    expect(available).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    await expect(result).resolves.toEqual({ updateInfo: expect.objectContaining({ version: '9.9.9-mock' }) })
    expect(available).toHaveBeenCalledWith(expect.objectContaining({ version: '9.9.9-mock' }))
  })

  it('emits complete upstream progress and downloaded event payloads', async () => {
    const updater = new MockAutoUpdater()
    const progress = vi.fn()
    const downloaded = vi.fn()
    updater.on('download-progress', progress)
    updater.on('update-downloaded', downloaded)

    await updater.downloadUpdate()
    await vi.advanceTimersByTimeAsync(100)

    expect(progress).toHaveBeenLastCalledWith({
      delta: 512 * 1024,
      total: 100 * 1024 * 1024,
      transferred: 512 * 1024,
      percent: 0.5,
      bytesPerSecond: 5 * 1024 * 1024,
    })
    expect(downloaded).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(19900)

    expect(downloaded).toHaveBeenCalledOnce()
    expect(downloaded).toHaveBeenCalledWith(expect.objectContaining({
      version: '9.9.9-mock',
      downloadedFile: 'mock-path',
    }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('quits the development app when installation is requested', async () => {
    const updater = new MockAutoUpdater()

    await updater.quitAndInstall()

    expect(app.quit).toHaveBeenCalledOnce()
  })
})
