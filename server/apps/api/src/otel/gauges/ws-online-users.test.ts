import type { EngagementMetrics, ObservabilityMetrics } from '..'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerWsOnlineUsersGauge } from './ws-online-users'

function makeGauge() {
  let callback: Parameters<EngagementMetrics['wsUsersOnline']['addCallback']>[0] | null = null
  const observe = vi.fn()
  const gauge: EngagementMetrics['wsUsersOnline'] = {
    addCallback: vi.fn((registeredCallback: typeof callback) => {
      callback = registeredCallback
    }),
    removeCallback: vi.fn(),
  }

  return {
    gauge,
    observe,
    run: async () => {
      if (!callback)
        throw new Error('No callback registered')
      await callback({ observe })
    },
  }
}

function makeReadErrors() {
  const add = vi.fn<ObservabilityMetrics['metricReadErrors']['add']>()
  return {
    metricReadErrors: { add },
    add,
  }
}

describe('registerWsOnlineUsersGauge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('counts each active per-user broadcast channel once', async () => {
    const pubsub = vi.fn(async () => [
      'user:user-1:chat:broadcast',
      'user:user-2:chat:broadcast',
    ])
    const { metricReadErrors } = makeReadErrors()
    const { gauge, observe, run } = makeGauge()

    registerWsOnlineUsersGauge(gauge, { pubsub }, metricReadErrors)
    await run()

    expect(pubsub).toHaveBeenCalledWith('CHANNELS', 'user:*:chat:broadcast')
    expect(observe).toHaveBeenCalledWith(2)
  })

  it('serves the cached count for repeated collections within ten seconds', async () => {
    const pubsub = vi.fn(async () => ['user:user-1:chat:broadcast'])
    const { metricReadErrors } = makeReadErrors()
    const { gauge, observe, run } = makeGauge()

    registerWsOnlineUsersGauge(gauge, { pubsub }, metricReadErrors)
    await run()
    vi.advanceTimersByTime(5_000)
    await run()

    expect(pubsub).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledTimes(2)
  })

  it('skips observation and records a read error when Redis is unavailable', async () => {
    const pubsub = vi.fn(async () => {
      throw new Error('Redis unavailable')
    })
    const { metricReadErrors, add } = makeReadErrors()
    const { gauge, observe, run } = makeGauge()

    registerWsOnlineUsersGauge(gauge, { pubsub }, metricReadErrors)
    await run()

    expect(observe).not.toHaveBeenCalled()
    expect(add).toHaveBeenCalledWith(1, { metric: 'ws.users.online' })
  })
})
