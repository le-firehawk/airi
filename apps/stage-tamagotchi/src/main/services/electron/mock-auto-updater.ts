import type { AppUpdater } from 'electron-updater'
import type { AppUpdaterEvents } from 'electron-updater/out/AppUpdater'

import { EventEmitter } from 'node:events'

import { app } from 'electron'

/** Simulates update events in development without an update feed or installer. */
export class MockAutoUpdater {
  private readonly events = new EventEmitter()

  autoDownload = false
  allowPrerelease = false
  forceDevUpdateConfig = false
  channel: AppUpdater['channel'] = null
  logger: AppUpdater['logger'] = null
  setFeedURL?: AppUpdater['setFeedURL']

  on<Event extends keyof AppUpdaterEvents>(event: Event, listener: AppUpdaterEvents[Event]): this {
    this.events.on(event, listener)
    return this
  }

  private emit<Event extends keyof AppUpdaterEvents>(event: Event, ...args: Parameters<AppUpdaterEvents[Event]>) {
    return this.events.emit(event, ...args)
  }

  async checkForUpdates() {
    this.emit('checking-for-update')

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Simulate update available
    // We can toggle this based on some logic if needed, but for now let's assume update is always available in mock
    const updateInfo = {
      version: '9.9.9-mock',
      files: [],
      path: 'mock-path',
      sha512: 'mock-sha',
      releaseDate: new Date().toISOString(),
      releaseNotes: '## Mock Update\n\nThis is a simulated update for testing purposes.\n\n- Feature A\n- Bugfix B',
    }

    this.emit('update-available', updateInfo)

    // In real updater, if autoDownload is true, it starts downloading.
    // We'll respect that if we were fully mocking, but typically we trigger download manually in this app.
    return { updateInfo }
  }

  async downloadUpdate() {
    // Simulate download progress
    const total = 100 * 1024 * 1024 // 100MB
    let transferred = 0
    const speed = 5 * 1024 * 1024 // 5MB/s simulation

    const interval = setInterval(() => {
      transferred += speed / 10 // Update every 100ms
      if (transferred > total)
        transferred = total

      const progress = {
        delta: speed / 10,
        total,
        transferred,
        percent: (transferred / total) * 100,
        bytesPerSecond: speed,
      }

      this.emit('download-progress', progress)

      if (transferred >= total) {
        clearInterval(interval)
        this.emit('update-downloaded', {
          downloadedFile: 'mock-path',
          version: '9.9.9-mock',
          files: [],
          path: 'mock-path',
          sha512: 'mock-sha',
          releaseDate: new Date().toISOString(),
          releaseNotes: '## Mock Update\n\nThis is a simulated update for testing purposes.\n\n- Feature A\n- Bugfix B',
        })
      }
    }, 100)
  }

  async quitAndInstall() {
    // eslint-disable-next-line no-console
    console.log('[MockAutoUpdater] quitAndInstall called. Quitting app...')
    app.quit()
  }
}
