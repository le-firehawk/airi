import type { Message, UserFromGetMe } from 'grammy/types'

import { embed } from '@xsai/embed'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chatMessagesTable } from '../db/schema'
import { recordMessage } from './chat-message'
import { findPhotoDescription } from './photos'
import { findStickerDescription } from './stickers'

const { insert, values } = vi.hoisted(() => {
  const values = vi.fn<(row: typeof chatMessagesTable.$inferInsert) => Promise<void>>()
  return { values, insert: vi.fn(() => ({ values })) }
})

vi.mock('../db', () => ({ useDrizzle: () => ({ insert }) }))
vi.mock('@xsai/embed', () => ({ embed: vi.fn() }))
vi.mock('./photos', () => ({ findPhotoDescription: vi.fn() }))
vi.mock('./stickers', () => ({ findStickerDescription: vi.fn() }))

const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'AIRI',
  username: 'airi_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
}
const user: NonNullable<Message['from']> = { id: 42, is_bot: false, first_name: 'Alice' }
const channel: Message['chat'] = { id: -100, type: 'channel', title: 'News' }

function textMessage(overrides: Partial<Message> = {}): Message {
  return { message_id: 10, date: 1, chat: channel, text: 'Hello', ...overrides }
}

// https://github.com/le-firehawk/airi/actions/runs/38045263989
// ROOT CAUSE:
// Missing sender fields caused crashes, and non-text messages left the embedding input uninitialized.
// Sender resolution preserves these messages. Caption initialization prevents undefined embedding requests.
describe('recordMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('EMBEDDING_DIMENSION', '1536')
    vi.mocked(embed).mockResolvedValue({
      embedding: [0.1, 0.2],
      input: 'Hello',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })
    values.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('records user messages with their real IDs', async () => {
    await recordMessage(botInfo, textMessage({ from: user }))

    expect(insert).toHaveBeenCalledWith(chatMessagesTable)
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ from_id: '42', from_name: 'Alice', content: 'Hello' }))
  })

  it('records channel messages without a user', async () => {
    await recordMessage(botInfo, textMessage({ sender_chat: channel }))

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ from_id: '-100', from_name: 'News', content: 'Hello' }))
  })

  it('uses the sender chat instead of a synthetic user', async () => {
    await recordMessage(botInfo, textMessage({ from: user, sender_chat: channel }))

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ from_id: '-100', from_name: 'News' }))
  })

  it('records senderless messages without inventing an ID', async () => {
    await recordMessage(botInfo, textMessage())

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ from_id: '', from_name: 'Unknown sender', content: 'Hello' }))
  })

  it('records replies to a message without a sender', async () => {
    await recordMessage(botInfo, textMessage({
      from: user,
      reply_to_message: { ...textMessage({ message_id: 5, text: 'Earlier' }), reply_to_message: undefined },
    }))

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ is_reply: true, reply_to_id: '5', reply_to_name: 'Unknown sender' }))
  })

  it('records replies to a channel sender', async () => {
    await recordMessage(botInfo, textMessage({
      from: user,
      reply_to_message: { ...textMessage({ sender_chat: channel }), reply_to_message: undefined },
    }))

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ reply_to_name: 'News' }))
  })

  it('identifies replies to the bot by ID', async () => {
    await recordMessage(botInfo, textMessage({
      from: user,
      reply_to_message: { ...textMessage({ from: { ...botInfo, first_name: 'Old name' } }), reply_to_message: undefined },
    }))

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ reply_to_name: 'Yourself' }))
  })

  it('keeps a different sender with the same first name as the bot', async () => {
    await recordMessage(botInfo, textMessage({
      from: user,
      reply_to_message: { ...textMessage({ from: { ...user, first_name: botInfo.first_name } }), reply_to_message: undefined },
    }))

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ reply_to_name: 'AIRI' }))
  })

  it('embeds captions when a media message has no text field', async () => {
    await recordMessage(botInfo, textMessage({
      from: user,
      text: undefined,
      caption: 'A recording',
      voice: { file_id: 'voice', file_unique_id: 'unique-voice', duration: 1 },
    }))

    expect(embed).toHaveBeenCalledWith(expect.objectContaining({ input: 'A recording' }))
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ content: 'A recording' }))
  })

  it('does not embed service messages with no text or supported media', async () => {
    await recordMessage(botInfo, textMessage({ text: undefined, new_chat_title: 'New title' }))

    expect(embed).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('records all photo descriptions without a user', async () => {
    vi.mocked(findPhotoDescription).mockResolvedValueOnce('A mountain').mockResolvedValueOnce('A lake')
    await recordMessage(botInfo, textMessage({
      text: undefined,
      sender_chat: channel,
      photo: [
        { file_id: 'photo-1', file_unique_id: 'unique-photo-1', width: 100, height: 100 },
        { file_id: 'photo-2', file_unique_id: 'unique-photo-2', width: 200, height: 200 },
      ],
    }))

    expect(findPhotoDescription).toHaveBeenCalledWith('photo-1')
    expect(findPhotoDescription).toHaveBeenCalledWith('photo-2')
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ from_id: '-100', content: 'A set of photo, descriptions are: A mountain\nA lake' }))
  })

  it('records sticker descriptions without sender information', async () => {
    vi.mocked(findStickerDescription).mockResolvedValue('A waving cat')
    await recordMessage(botInfo, textMessage({
      text: undefined,
      sticker: {
        file_id: 'sticker',
        file_unique_id: 'unique-sticker',
        type: 'regular',
        width: 100,
        height: 100,
        is_animated: false,
        is_video: false,
        set_name: 'Cats',
      },
    }))

    expect(findStickerDescription).toHaveBeenCalledWith('sticker')
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ from_id: '', content: 'A sticker sent by user A waving cat, sticker set named Cats' }))
  })

  it.each(['1536', '1024', '768'])('stores embeddings with dimension %s', async (dimension) => {
    vi.stubEnv('EMBEDDING_DIMENSION', dimension)
    await recordMessage(botInfo, textMessage({ from: user }))

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ [`content_vector_${dimension}`]: [0.1, 0.2] }))
  })
})
