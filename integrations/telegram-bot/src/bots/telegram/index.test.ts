import type { GenerateTextResult } from '@xsai/generate-text'
import type { Chat, Message, Update, UserFromGetMe } from 'grammy/types'

import { generateText } from '@xsai/generate-text'
import { Api, Bot } from 'grammy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findStickerByFileId, recordMessage } from '../../models'
import { recordJoinedChat } from '../../models/chats'
import { startTelegramBot } from './index'

vi.mock('@xsai/generate-text', () => ({ generateText: vi.fn() }))
vi.mock('../../models', async importOriginal => ({
  ...await importOriginal<typeof import('../../models')>(),
  recordMessage: vi.fn(),
  findStickerByFileId: vi.fn(),
}))
vi.mock('../../models/chats', () => ({ recordJoinedChat: vi.fn(), listJoinedChats: vi.fn() }))

const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'AIRI',
  username: 'airi_bot',
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
}

function modelResult(text: string): GenerateTextResult {
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
  return { text, usage, totalUsage: usage, finishReason: 'stop', messages: [], steps: [], toolCalls: [], toolResults: [] }
}

function textMessage(chatId: number, text: string): Message.TextMessage & { chat: Chat.ChannelChat, reply_to_message: undefined } {
  return { message_id: 1, date: 1, chat: { id: chatId, type: 'channel', title: `Channel ${chatId}` }, text, reply_to_message: undefined }
}

async function startBot() {
  vi.spyOn(Bot.prototype, 'init').mockImplementation(async function (this: Bot) {
    this.botInfo = botInfo
  })
  const start = vi.spyOn(Bot.prototype, 'start').mockResolvedValue(undefined)
  await startTelegramBot()
  const bot = start.mock.contexts[0]
  if (!(bot instanceof Bot))
    throw new Error('Bot did not start')
  return bot
}

// https://github.com/le-firehawk/airi/actions/runs/38045263989
// ROOT CAUSE:
// Commands assumed a user and a sticker set. The shared queue reused the first chat context for later messages.
// Guards validate command prerequisites, and each queued message selects its own chat context.
describe('telegram message dispatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '1:test-token')
    vi.stubEnv('ADMIN_USER_IDS', '42')
    vi.mocked(generateText).mockResolvedValue(modelResult('{"action":"continue"}'))
    vi.mocked(recordMessage).mockResolvedValue(undefined)
    vi.mocked(findStickerByFileId).mockResolvedValue(undefined)
    vi.mocked(recordJoinedChat).mockResolvedValue({ command: 'INSERT', rowCount: 1, oid: 0, rows: [], fields: [] })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetAllMocks()
    vi.unstubAllEnvs()
  })

  it('accepts channel posts without a user sender', async () => {
    const bot = await startBot()
    const message = textMessage(-100, 'Channel news')
    await bot.handleUpdate({ update_id: 1, channel_post: message })
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce())

    expect(recordMessage).toHaveBeenCalledWith(botInfo, message)
    expect(recordJoinedChat).toHaveBeenCalledWith('-100', 'Channel -100')
  })

  it('ignores senderless administrative commands without a crash', async () => {
    const getStickerSet = vi.spyOn(Api.prototype, 'getStickerSet')
    const bot = await startBot()
    const message = { ...textMessage(-100, '/add_sticker_pack'), entities: [{ type: 'bot_command' as const, offset: 0, length: 17 }] }
    const update: Update = { update_id: 1, channel_post: message }

    await expect(bot.handleUpdate(update)).resolves.toBeUndefined()
    expect(getStickerSet).not.toHaveBeenCalled()
  })

  it('asks an administrator for a sticker pack when the replied message has no sticker', async () => {
    const send = vi.spyOn(Api.prototype, 'sendMessage').mockResolvedValue(textMessage(-100, 'Reply'))
    const getStickerSet = vi.spyOn(Api.prototype, 'getStickerSet')
    const bot = await startBot()
    const message = {
      ...textMessage(-100, '/add_sticker_pack'),
      chat: { id: -100, type: 'group' as const, title: 'Friends' },
      from: { id: 42, is_bot: false, first_name: 'Admin' },
      entities: [{ type: 'bot_command' as const, offset: 0, length: 17 }],
      reply_to_message: { ...textMessage(-100, 'Not a sticker'), chat: { id: -100, type: 'group' as const, title: 'Friends' } },
    }

    await bot.handleUpdate({ update_id: 1, message })

    expect(send).toHaveBeenCalledWith(-100, 'Please reply to a sticker from a sticker pack.', expect.any(Object), undefined)
    expect(getStickerSet).not.toHaveBeenCalled()
  })

  it('does not dispatch a late model response after a newer message interrupts it', async () => {
    const getFile = vi.spyOn(Api.prototype, 'getFile').mockRejectedValue(new Error('Unexpected stale sticker lookup'))
    const bot = await startBot()
    const stale = Promise.withResolvers<GenerateTextResult>()
    vi.mocked(generateText).mockReturnValueOnce(stale.promise)
    await bot.handleUpdate({ update_id: 1, channel_post: textMessage(-100, 'Earlier') })
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce())
    await bot.handleUpdate({ update_id: 2, channel_post: { ...textMessage(-100, 'Newer'), message_id: 2 } })
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledTimes(2))

    stale.resolve(modelResult('{"action":"send_sticker","chatId":"-100","fileId":"stale-sticker"}'))
    await vi.advanceTimersByTimeAsync(0)

    expect(getFile).not.toHaveBeenCalled()
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('does not interrupt newer generation when a canceled sticker delivery resolves late', async () => {
    const bot = await startBot()
    vi.spyOn(Api.prototype, 'getFile').mockResolvedValue({ file_id: 'sticker', file_unique_id: 'unique-sticker', file_path: 'sticker.webp' })
    const delivery = Promise.withResolvers<Message.StickerMessage>()
    const sendSticker = vi.spyOn(Api.prototype, 'sendSticker').mockReturnValue(delivery.promise)
    const newerGeneration = Promise.withResolvers<GenerateTextResult>()
    vi.mocked(generateText)
      .mockResolvedValueOnce(modelResult('{"action":"send_sticker","chatId":"-100","fileId":"sticker"}'))
      .mockReturnValueOnce(newerGeneration.promise)

    await bot.handleUpdate({ update_id: 1, channel_post: textMessage(-100, 'Send a sticker') })
    await vi.waitFor(() => expect(sendSticker).toHaveBeenCalledOnce())
    await bot.handleUpdate({ update_id: 2, channel_post: { ...textMessage(-100, 'Newer message'), message_id: 2 } })
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledTimes(2))
    const newerSignal = vi.mocked(generateText).mock.calls[1][0].abortSignal

    expect(sendSticker.mock.calls[0][3]?.aborted).toBe(true)
    expect(newerSignal).toBeDefined()
    expect(newerSignal?.aborted).toBe(false)

    delivery.resolve({
      message_id: 3,
      date: 1,
      chat: { id: -100, type: 'channel', title: 'Channel -100' },
      sticker: { file_id: 'sticker', file_unique_id: 'unique-sticker', type: 'regular', width: 512, height: 512, is_animated: false, is_video: false },
    })
    try {
      await vi.advanceTimersByTimeAsync(0)

      expect(newerSignal?.aborted).toBe(false)
      expect(generateText).toHaveBeenCalledTimes(2)
    }
    finally {
      newerGeneration.resolve(modelResult('{"action":"continue"}'))
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it('keeps queued chats and their action history separate', async () => {
    const bot = await startBot()
    const persisted = Promise.withResolvers<void>()
    vi.mocked(recordMessage).mockImplementationOnce(() => persisted.promise)
    const first = bot.handleUpdate({ update_id: 1, channel_post: textMessage(-100, 'First chat') })
    await vi.waitFor(() => expect(recordMessage).toHaveBeenCalledOnce())
    await bot.handleUpdate({ update_id: 2, channel_post: textMessage(-200, 'Second chat') })
    persisted.resolve()
    await first
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledTimes(2))

    const secondRequest = vi.mocked(generateText).mock.calls[1][0]
    expect(JSON.stringify(secondRequest.messages)).toContain('Second chat')
    expect(JSON.stringify(secondRequest.messages)).not.toContain('Acknowledged, will now continue')
    expect(recordJoinedChat).toHaveBeenCalledWith('-100', 'Channel -100')
    expect(recordJoinedChat).toHaveBeenCalledWith('-200', 'Channel -200')
  })
})
