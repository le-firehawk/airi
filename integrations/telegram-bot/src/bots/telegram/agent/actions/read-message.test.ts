import type { Message } from 'grammy/types'

import type { BotContext } from '../../../../types'

import { useLogg } from '@guiiai/logg'
import { embed } from '@xsai/embed'
import { Bot } from 'grammy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findLastNMessages, findRelevantMessages } from '../../../../models'
import { readMessage } from './read-message'

vi.mock('@xsai/embed', () => ({ embed: vi.fn() }))
vi.mock('../../../../models', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../models')>(),
  findLastNMessages: vi.fn(),
  findRelevantMessages: vi.fn(),
}))

function createContext(): BotContext {
  return {
    bot: new Bot('123:test'),
    logger: useLogg('test'),
    messageQueue: [],
    unreadMessages: {},
    processedIds: new Set(),
    processing: false,
    lastInteractedNChatIds: [],
    chats: new Map(),
  }
}

function incomingMessage(messageId: number, text: string): Message.TextMessage {
  return { message_id: messageId, date: 1, chat: { id: -100, type: 'channel', title: 'News' }, text }
}

// https://github.com/le-firehawk/airi/actions/runs/38045263989
// ROOT CAUSE:
// The read indexed an optional chat queue and cleared messages that arrived during asynchronous work.
// A stable read snapshot and selective consumption preserve later arrivals and aborted reads.
describe('readMessage unread state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findLastNMessages).mockResolvedValue([])
    vi.mocked(findRelevantMessages).mockResolvedValue([])
    vi.mocked(embed).mockResolvedValue({ embedding: [0.1], input: 'Earlier', usage: { prompt_tokens: 1, total_tokens: 1 } })
  })

  it('reads its supplied snapshot when the chat queue no longer exists', async () => {
    const state = createContext()
    const result = await readMessage(state, '123', '-100', { action: 'read_unread_messages', chatId: '-100' }, [incomingMessage(1, 'Earlier')], new AbortController())

    expect(result.result).toContain('Earlier')
    expect(state.unreadMessages['-100']).toBeUndefined()
  })

  it('keeps later arrivals outside the completed read snapshot', async () => {
    const state = createContext()
    const earlier = incomingMessage(1, 'Earlier')
    const later = incomingMessage(2, 'Later')
    state.unreadMessages['-100'] = [earlier]
    const found = Promise.withResolvers<Awaited<ReturnType<typeof findLastNMessages>>>()
    vi.mocked(findLastNMessages).mockReturnValue(found.promise)

    const reading = readMessage(state, '123', '-100', { action: 'read_unread_messages', chatId: '-100' }, state.unreadMessages['-100'], new AbortController())
    state.unreadMessages['-100'].push(later)
    found.resolve([])
    const result = await reading

    expect(result.result).toContain('Earlier')
    expect(result.result).not.toContain('Later')
    expect(state.unreadMessages['-100']).toEqual([later])
    expect(embed).toHaveBeenCalledTimes(1)
  })

  it('retains unread messages when an in-flight read is aborted', async () => {
    const state = createContext()
    const earlier = incomingMessage(1, 'Earlier')
    state.unreadMessages['-100'] = [earlier]
    const controller = new AbortController()
    vi.mocked(findRelevantMessages).mockImplementation(async () => {
      controller.abort()
      return []
    })

    await expect(readMessage(state, '123', '-100', { action: 'read_unread_messages', chatId: '-100' }, state.unreadMessages['-100'], controller)).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.unreadMessages['-100']).toEqual([earlier])
  })
})
