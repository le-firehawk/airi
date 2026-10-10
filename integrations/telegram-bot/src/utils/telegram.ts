import type { AbortSignal as TelegramAbortSignal } from 'abort-controller'

import { AbortController as TelegramAbortController } from 'abort-controller'

// NOTICE:
// Grammy's Node entry requires the abort-controller signal type.
// Native signals have incompatible event listener declarations.
// Source: grammy/out/shim.node.d.ts and grammy/out/core/api.d.ts.
// Remove this adapter when Grammy accepts native AbortSignal.
/**
 * Forwards native cancellation to one Grammy request.
 * The native listener remains active until cancellation or request settlement.
 * A confirmed result still returns when cancellation races with delivery.
 */
export async function withTelegramAbortSignal<T>(signal: AbortSignal, operation: (signal: TelegramAbortSignal) => Promise<T>): Promise<T> {
  const controller = new TelegramAbortController()

  function onAbort() {
    signal.removeEventListener('abort', onAbort)
    controller.abort()
  }

  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) {
    onAbort()
  }

  try {
    return await operation(controller.signal)
  }
  finally {
    signal.removeEventListener('abort', onAbort)
  }
}
