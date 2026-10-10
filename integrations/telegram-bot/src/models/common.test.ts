import type { Message } from 'grammy/types'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveMessageSender, telegramMessageToOneLine } from './common'
import { findPhotoDescription } from './photos'
import { findStickerDescription } from './stickers'

vi.mock('./photos', () => ({ findPhotoDescription: vi.fn() }))
vi.mock('./stickers', () => ({ findStickerDescription: vi.fn() }))

const channel: Message['chat'] = { id: -100, type: 'channel', title: 'News' }
const user: NonNullable<Message['from']> = { id: 42, is_bot: false, first_name: 'Alice' }

function textMessage(overrides: Partial<Message> = {}): Message {
  return { message_id: 10, date: 1, chat: channel, text: 'Hello', ...overrides }
}

// https://github.com/le-firehawk/airi/actions/runs/38045263989
// ROOT CAUSE:
// Telegram can omit user senders or supply synthetic users for chat senders.
// Sender resolution now preserves user, chat, and absent identities for messages and replies.
describe('telegramMessageToOneLine', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('formats a channel sender without a user', async () => {
    const result = await telegramMessageToOneLine('1', textMessage({ sender_chat: channel }))

    expect(result).toContain('Chat [Display name: News]')
    expect(result).toContain('said: Hello')
    expect(result).not.toContain('undefined')
  })

  it('preserves a message without sender information', async () => {
    const result = await telegramMessageToOneLine('1', textMessage())

    expect(result).toContain('Unknown sender')
    expect(result).toContain('said: Hello')
  })

  it('uses the sender chat instead of a synthetic user', async () => {
    const result = await telegramMessageToOneLine('42', textMessage({ from: user, sender_chat: channel }))

    expect(result).toContain('Chat [Display name: News]')
    expect(result).not.toContain('Yourself')
  })

  it('formats replies whose sender is absent', async () => {
    const result = await telegramMessageToOneLine('1', textMessage({
      from: user,
      reply_to_message: { ...textMessage({ text: 'Earlier' }), reply_to_message: undefined },
    }))

    expect(result).toContain('replied to Unknown sender for content Earlier')
    expect(result).not.toContain('undefined')
  })

  it('recognizes replies to the bot by its user ID', async () => {
    const result = await telegramMessageToOneLine('42', textMessage({
      sender_chat: channel,
      reply_to_message: { ...textMessage({ from: user, text: 'Earlier' }), reply_to_message: undefined },
    }))

    expect(result).toContain('replied to your previous message Earlier')
  })

  it('keeps caption-only message content', async () => {
    const result = await telegramMessageToOneLine('1', textMessage({
      from: user,
      text: undefined,
      caption: 'A recording',
      voice: { file_id: 'voice', file_unique_id: 'unique-voice', duration: 1 },
    }))

    expect(result).toContain('said: A recording')
  })

  it('formats senderless photos with their stored descriptions', async () => {
    vi.mocked(findPhotoDescription).mockResolvedValue('A mountain')
    const result = await telegramMessageToOneLine('1', textMessage({
      text: undefined,
      photo: [{ file_id: 'photo', file_unique_id: 'unique-photo', width: 100, height: 100 }],
    }))

    expect(findPhotoDescription).toHaveBeenCalledWith('photo')
    expect(result).toContain('Unknown sender')
    expect(result).toContain('description of the photo is A mountain')
  })

  it('formats channel stickers with their stored descriptions', async () => {
    vi.mocked(findStickerDescription).mockResolvedValue('A waving cat')
    const result = await telegramMessageToOneLine('1', textMessage({
      text: undefined,
      sender_chat: channel,
      sticker: {
        file_id: 'sticker',
        file_unique_id: 'unique-sticker',
        type: 'regular',
        width: 100,
        height: 100,
        is_animated: false,
        is_video: false,
      },
    }))

    expect(findStickerDescription).toHaveBeenCalledWith('sticker')
    expect(result).toContain('Chat [Display name: News]')
    expect(result).toContain('description of the sticker is A waving cat')
  })
})

describe('resolveMessageSender', () => {
  it('retains real user IDs and optional display details', () => {
    const result = resolveMessageSender({ from: { ...user, last_name: 'Smith', username: 'alice' } })

    expect(result).toEqual({
      kind: 'user',
      id: '42',
      name: 'Alice',
      displayName: 'User [Display name: Alice Smith (username: alice)]',
    })
  })

  it('retains chat IDs when a synthetic user is also present', () => {
    const result = resolveMessageSender({ from: user, sender_chat: channel })

    expect(result).toEqual({ kind: 'chat', id: '-100', name: 'News', displayName: 'Chat [Display name: News]' })
  })

  it('leaves absent sender IDs unset', () => {
    const result = resolveMessageSender({})

    expect(result).toEqual({ kind: 'absent', id: undefined, name: 'Unknown sender', displayName: 'Unknown sender' })
  })
})
