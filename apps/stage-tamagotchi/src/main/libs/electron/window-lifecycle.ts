import type { BrowserWindow } from 'electron'

import { useLogg } from '@guiiai/logg'

type WindowOwner = Pick<BrowserWindow, 'isDestroyed' | 'once' | 'off'>
type Cleanup = () => unknown

const owners = new WeakMap<WindowOwner, WindowCleanup>()
const log = useLogg('window-lifecycle').useGlobalConfig()

function reportErrors(errors: unknown[]) {
  // The logger serializes cause, which preserves each failed cleanup in one diagnostic.
  if (errors.length)
    log.withError(new AggregateError(errors, 'Window cleanup failed', { cause: errors })).error('Failed to release closed-window resources')
}

function runCleanups(callbacks: Cleanup[]) {
  const errors: unknown[] = []
  for (const callback of callbacks) {
    try {
      // Cleanup starts synchronously. A rejected async result cannot stop other owners or become unhandled.
      void Promise.resolve(callback()).catch(error => reportErrors([error]))
    }
    catch (error) {
      errors.push(error)
    }
  }
  reportErrors(errors)
}

/** One native listener owns independent registrations until the window closes or every registration is removed. */
class WindowCleanup {
  private readonly callbacks = new Map<symbol, Cleanup>()
  private closed: boolean

  constructor(private readonly window: WindowOwner) {
    this.closed = window.isDestroyed()
    if (!this.closed)
      window.once('closed', this.close)
  }

  private readonly close = () => {
    if (this.closed)
      return
    // The event is authoritative even before Electron reports the window as destroyed.
    this.closed = true
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    runCleanups(callbacks)
  }

  register(callback: Cleanup) {
    if (this.closed) {
      runCleanups([callback])
      return () => {}
    }

    const token = Symbol('window-cleanup')
    this.callbacks.set(token, callback)
    return () => {
      if (!this.callbacks.delete(token))
        return
      if (!this.closed && this.callbacks.size === 0) {
        this.window.off('closed', this.close)
        owners.delete(this.window)
      }
    }
  }
}

/**
 * Runs cleanup once when its window closes and returns an idempotent unregistration function.
 * Duplicate callbacks remain independent. Unregistration does not run cleanup.
 * Close dispatch takes a snapshot, so removing another registration cannot skip its pending cleanup.
 * Registrations during or after closure run immediately. Failures are reported without blocking other cleanup or native listeners.
 */
export function onWindowClosed(window: WindowOwner, callback: Cleanup): () => void {
  let owner = owners.get(window)
  if (!owner) {
    owner = new WindowCleanup(window)
    owners.set(window, owner)
  }
  return owner.register(callback)
}
