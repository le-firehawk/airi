/** An operation whose cancellation aborts its work and rejects its result. */
export interface CancellablePromise<T> {
  promise: Promise<T>
  cancel: () => void
}

/**
 * Starts work with a shared abort signal. Cancellation settles the result immediately.
 * The operation must honor the signal before each side effect. Late failures remain handled.
 * After settlement, cancellation has no effect.
 */
export function cancellable<T>(operation: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal): CancellablePromise<T> {
  const controller = new AbortController()
  const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal
  let pending = true

  const promise = new Promise<T>((resolve, reject) => {
    function settle() {
      pending = false
      signal.removeEventListener('abort', onAbort)
    }

    function onAbort() {
      settle()
      reject(signal.reason)
    }

    if (signal.aborted) {
      onAbort()
      return
    }

    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return operation(signal)
    }).then((value) => {
      settle()
      resolve(value)
    }, (error: unknown) => {
      settle()
      reject(error)
    })
  })

  return {
    promise,
    cancel: () => {
      if (pending) {
        controller.abort(new Error('CANCELLED'))
      }
    },
  }
}
