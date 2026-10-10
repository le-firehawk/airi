import { describe, expect, it, vi } from 'vitest'

import { createUnauthorizedWsEvents, WS_CLOSE_UNAUTHORIZED } from '../ws-auth'

describe('createUnauthorizedWsEvents', () => {
  // ROOT CAUSE:
  // Rejecting before the WebSocket upgrade hides HTTP 401 behind browser close code 1006, so clients retry stale tokens.
  // Accepting the upgrade and closing with 4001 lets the client stop retries until its token changes.
  it('closes the socket with WS_CLOSE_UNAUTHORIZED immediately on open', () => {
    const close = vi.fn<(code?: number, reason?: string) => void>()
    const events = createUnauthorizedWsEvents()

    // Hono's WSEvents allows partial maps; only onOpen is set here.
    expect(events.onOpen).toBeDefined()
    events.onOpen!(new Event('open'), { close } as any)

    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith(WS_CLOSE_UNAUTHORIZED, 'unauthorized')
    expect(WS_CLOSE_UNAUTHORIZED).toBe(4001)
  })
})
