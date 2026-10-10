import type { SatoriEvent } from '../../adapter/satori/types'
import type { BotContext } from '../types'

import { useLogg } from '@guiiai/logg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SatoriClient } from '../../adapter/satori/client'
import { pushToEventQueue, pushToUnreadEvents, recordChannel, recordMessage, removeFromEventQueue } from '../../lib/db'
import { setupMessageEventHandler } from './queue'
import { onMessageArrival } from './scheduler'

vi.mock('../../lib/db', () => ({
  pushToEventQueue: vi.fn().mockResolvedValue('queued-event'),
  pushToUnreadEvents: vi.fn().mockResolvedValue('unread-event'),
  recordChannel: vi.fn().mockResolvedValue(undefined),
  recordMessage: vi.fn().mockResolvedValue(undefined),
  removeFromEventQueue: vi.fn().mockResolvedValue(undefined),
  saveEventQueue: vi.fn().mockResolvedValue(undefined),
}))

function createContext(): BotContext {
  return {
    logger: useLogg('satori-queue-test'),
    eventQueue: [],
    unreadEvents: {},
    processedIds: new Set(),
    lastInteractedChannelIds: [],
    chats: new Map([['channel-1', {
      channelId: 'channel-1',
      platform: 'test',
      selfId: 'bot-1',
      isProcessing: true,
      actions: [],
    }]]),
  }
}

function createEvent(overrides: Partial<SatoriEvent> = {}): SatoriEvent {
  return {
    id: 1,
    type: 'message-created',
    platform: 'test',
    self_id: 'bot-1',
    timestamp: 1,
    channel: { id: 'channel-1', type: 0 },
    message: { id: 'message-1', content: 'Hello' },
    user: { id: 'user-1', name: 'Alice' },
    ...overrides,
  }
}

function setupHandler(ctx: BotContext) {
  const client = new SatoriClient({ url: 'ws://localhost:5140/satori/v1/events' })
  const on = vi.spyOn(client, 'on')
  setupMessageEventHandler(client, ctx, ctx.logger)
  const subscription = on.mock.calls.find(([type]) => type === 'message-created')
  if (!subscription)
    throw new Error('Missing message-created subscription')

  return subscription[1]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('satori message intake', () => {
  it('persists and consumes a message once across repeated deliveries', async () => {
    const ctx = createContext()
    const handler = setupHandler(ctx)
    const event = createEvent()

    await handler(event)
    await handler(event)

    expect(pushToEventQueue).toHaveBeenCalledExactlyOnceWith({ event, status: 'ready' })
    expect(recordMessage).toHaveBeenCalledExactlyOnceWith('channel-1', 'user-1', 'Alice', 'Hello')
    expect(pushToUnreadEvents).toHaveBeenCalledExactlyOnceWith('channel-1', event)
    expect(removeFromEventQueue).toHaveBeenCalledExactlyOnceWith('queued-event')
    expect(ctx.eventQueue).toEqual([])
    expect(ctx.unreadEvents['channel-1']).toEqual([{ id: 'unread-event', event }])
  })

  it('uses an available member identity when the event has no top-level user', async () => {
    const ctx = createContext()
    const handler = setupHandler(ctx)
    const event = createEvent({ user: undefined, member: { user: { id: 'member-1', name: 'Member' } } })

    await handler(event)

    expect(recordMessage).toHaveBeenCalledExactlyOnceWith('channel-1', 'member-1', 'Member', 'Hello')
    expect(pushToUnreadEvents).toHaveBeenCalledExactlyOnceWith('channel-1', event)
  })

  it('uses the top-level user before the member identity', async () => {
    const ctx = createContext()
    const handler = setupHandler(ctx)
    const event = createEvent({ member: { user: { id: 'member-1', name: 'Member' } } })

    await handler(event)

    expect(recordMessage).toHaveBeenCalledExactlyOnceWith('channel-1', 'user-1', 'Alice', 'Hello')
    expect(pushToUnreadEvents).toHaveBeenCalledExactlyOnceWith('channel-1', event)
  })

  it('keeps senderless channel messages without inventing a message-history identity', async () => {
    const ctx = createContext()
    const handler = setupHandler(ctx)
    const event = createEvent({ user: undefined })

    await handler(event)

    expect(pushToEventQueue).toHaveBeenCalledExactlyOnceWith({ event, status: 'ready' })
    expect(recordMessage).not.toHaveBeenCalled()
    expect(pushToUnreadEvents).toHaveBeenCalledExactlyOnceWith('channel-1', event)
    expect(ctx.unreadEvents['channel-1']).toEqual([{ id: 'unread-event', event }])
  })

  it('rejects an unroutable message before persistence or deduplication', async () => {
    const ctx = createContext()
    const handler = setupHandler(ctx)

    await handler(createEvent({ channel: undefined }))

    expect(pushToEventQueue).not.toHaveBeenCalled()
    expect(recordChannel).not.toHaveBeenCalled()
    expect(ctx.processedIds.size).toBe(0)

    const event = createEvent()
    await handler(event)

    expect(pushToUnreadEvents).toHaveBeenCalledExactlyOnceWith('channel-1', event)
  })

  it('ignores an event without a message resource', async () => {
    const ctx = createContext()
    const handler = setupHandler(ctx)

    await handler(createEvent({ message: undefined }))

    expect(pushToEventQueue).not.toHaveBeenCalled()
    expect(ctx.processedIds.size).toBe(0)
  })

  it('filters the bot member identity from unread events', async () => {
    const ctx = createContext()
    const handler = setupHandler(ctx)
    const event = createEvent({ user: undefined, member: { user: { id: 'bot-1', name: 'Bot' } } })

    await handler(event)

    expect(recordMessage).toHaveBeenCalledExactlyOnceWith('channel-1', 'bot-1', 'Bot', 'Hello')
    expect(pushToUnreadEvents).not.toHaveBeenCalled()
    expect(removeFromEventQueue).toHaveBeenCalledExactlyOnceWith('queued-event')
    expect(ctx.eventQueue).toEqual([])
  })
})

describe('satori queued events', () => {
  it('keeps channel system events that have neither a user nor a message', async () => {
    const ctx = createContext()
    const client = new SatoriClient({ url: 'ws://localhost:5140/satori/v1/events' })
    const event = createEvent({ type: 'channel-updated', guild: { id: 'guild-1' }, user: undefined, message: undefined })
    ctx.eventQueue.push({ id: 'system-event', status: 'ready', event })

    await onMessageArrival(ctx, client)

    expect(recordChannel).toHaveBeenCalledExactlyOnceWith('channel-1', 'channel-1', 'test', 'bot-1')
    expect(recordMessage).not.toHaveBeenCalled()
    expect(pushToUnreadEvents).toHaveBeenCalledExactlyOnceWith('channel-1', event)
    expect(removeFromEventQueue).toHaveBeenCalledExactlyOnceWith('system-event')
    expect(ctx.eventQueue).toEqual([])
  })

  it('keeps an event with empty content in the unread queue', async () => {
    const ctx = createContext()
    const handler = setupHandler(ctx)
    const event = createEvent({ message: { id: 'message-1', content: '' } })

    await handler(event)

    expect(recordMessage).not.toHaveBeenCalled()
    expect(pushToUnreadEvents).toHaveBeenCalledExactlyOnceWith('channel-1', event)
  })
})
