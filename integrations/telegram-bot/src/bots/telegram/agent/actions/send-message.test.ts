import type { GenerateTextResult } from '@xsai/generate-text'
import type { Message, UserFromGetMe } from 'grammy/types'

import type { BotContext, ChatContext } from '../../../../types'

import { useLogg } from '@guiiai/logg'
import { generateText } from '@xsai/generate-text'
import { AbortSignal as TelegramAbortSignal } from 'abort-controller'
import { Bot } from 'grammy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { recordMessage } from '../../../../models'
import { listJoinedChats } from '../../../../models/chats'
import { parseMayStructuredMessage, sendMessage } from './send-message'

vi.mock('@xsai/generate-text', () => ({ generateText: vi.fn() }))
vi.mock('../../../../models', () => ({ recordMessage: vi.fn() }))
vi.mock('../../../../models/chats', () => ({ listJoinedChats: vi.fn() }))

describe('parseMayStructuredMessage', () => {
  it('return an array of messages', () => {
    const result = parseMayStructuredMessage('{"messages": ["Hello, world!"]}')
    expect(result).toMatchObject({ messages: ['Hello, world!'] })
  })

  it('return an array of messages from multi-line input', () => {
    const result = parseMayStructuredMessage(`{"messages": [
"Hello, world!",
"Hello, world!"
]}`)
    expect(result).toMatchObject({ messages: ['Hello, world!', 'Hello, world!'] })
  })

  it('return an array of messages from multi-line input with extra whitespace', () => {
    const result = parseMayStructuredMessage(`{"messages": [
      "Hello, world!",
      "Hello, world!"
    ]}`)
    expect(result).toMatchObject({ messages: ['Hello, world!', 'Hello, world!'] })
  })

  it('return an object with messages and reply_to_message_id', () => {
    const result = parseMayStructuredMessage(`{"messages": [
      "Hello, world!",
      "Hello, world!"
    ], "reply_to_message_id": "1234567890"
    }`)
    expect(result).toMatchObject({ messages: ['Hello, world!', 'Hello, world!'], reply_to_message_id: '1234567890' })
  })

  it('fall back to the original text when structured output omits messages', () => {
    const text = '{"reply_to_message_id":"1234567890"}'
    const result = parseMayStructuredMessage(text)
    expect(result).toMatchObject({ messages: [text], reply_to_message_id: '1234567890' })
  })

  it('fall back to the original text when structured output uses a non-array messages field', () => {
    const text = '{"messages":"Hello, world!"}'
    const result = parseMayStructuredMessage(text)
    expect(result).toMatchObject({ messages: [text], reply_to_message_id: undefined })
  })

  it('return null when structured output has an empty messages array', () => {
    const result = parseMayStructuredMessage('{"messages":[]}')
    expect(result).toBeNull()
  })

  it('return null when structured output has only blank messages', () => {
    const result = parseMayStructuredMessage('{"messages":["", "   "]}')
    expect(result).toBeNull()
  })

  it('return an array of messages from multi-line elements of input', () => {
    const result = parseMayStructuredMessage(`{"messages": [
"Hello,
world!",
"Hello,
world!"
    ]}`)
    expect(result).toMatchObject({ messages: ['Hello,\nworld!', 'Hello,\nworld!'] })
  })
})

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

function modelResult(text?: string): GenerateTextResult {
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
  return { text, usage, totalUsage: usage, finishReason: 'stop', messages: [], steps: [], toolCalls: [], toolResults: [] }
}

function sentMessage(text: string, messageId = 10): Message.TextMessage {
  return { message_id: messageId, date: 1, chat: { id: -100, type: 'group', title: 'Friends' }, from: botInfo, text }
}

function createContext() {
  const bot = new Bot('1:test-token', { botInfo })
  const chatContext: ChatContext = { chatId: '-100', messages: [], actions: [] }
  const botContext: BotContext = {
    bot,
    messageQueue: [],
    unreadMessages: {},
    processedIds: new Set(),
    logger: useLogg('send-message-test'),
    processing: false,
    lastInteractedNChatIds: [],
    chats: new Map([['-100', chatContext]]),
  }
  const send = vi.spyOn(bot.api, 'sendMessage').mockImplementation(async (_chatId, text) => sentMessage(text))
  const typing = vi.spyOn(bot.api, 'sendChatAction').mockResolvedValue(true)
  return { botContext, chatContext, send, typing, controller: new AbortController() }
}

describe('sendMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(listJoinedChats).mockResolvedValue([{
      id: 'joined-chat',
      platform: 'telegram',
      chat_id: '-100',
      chat_name: 'Friends',
      created_at: 1,
      updated_at: 1,
    }])
    vi.mocked(recordMessage).mockResolvedValue(undefined)
    vi.mocked(generateText).mockResolvedValue(modelResult('A message with a long typing delay.'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  it('reports absent model text before text processing', async () => {
    const { botContext, chatContext, send, controller } = createContext()
    vi.mocked(generateText).mockResolvedValue(modelResult())

    await expect(sendMessage(botContext, chatContext, 'Input', '-100', controller)).rejects.toThrow('No response text')

    expect(send).not.toHaveBeenCalled()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('stops during the typing delay when the current task is canceled', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    const result = sendMessage(botContext, chatContext, 'Input', '-100', controller).catch(error => error)
    await vi.waitFor(() => expect(typing).toHaveBeenCalledOnce())

    expect(chatContext.currentTask).toBeDefined()
    chatContext.currentTask?.cancel()

    await expect(result).resolves.toEqual(new Error('CANCELLED'))
    await vi.runAllTimersAsync()
    expect(send).not.toHaveBeenCalled()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it.each(['', '   ', '<think>Only reasoning</think>'])('rejects empty message text: %j', async (text) => {
    const { botContext, chatContext, send, controller } = createContext()
    vi.mocked(generateText).mockResolvedValue(modelResult(text))

    await expect(sendMessage(botContext, chatContext, 'Input', '-100', controller)).rejects.toThrow('No response text')

    expect(send).not.toHaveBeenCalled()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('sends all message parts and replies only with the first part', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    vi.mocked(generateText).mockResolvedValue(modelResult('{"messages":["First message", "Second message"],"reply_to_message_id":"23"}'))
    const result = sendMessage(botContext, chatContext, 'Input', '-100', controller)
    await vi.waitFor(() => expect(typing).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()
    await result

    const signal = vi.mocked(generateText).mock.calls[0]?.[0].abortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, '-100', 'First message', { reply_parameters: { message_id: 23 } }, expect.any(TelegramAbortSignal))
    expect(send).toHaveBeenNthCalledWith(2, '-100', 'Second message', undefined, expect.any(TelegramAbortSignal))
    expect(typing).toHaveBeenCalledWith('-100', 'typing', undefined, expect.any(TelegramAbortSignal))
    expect(recordMessage).toHaveBeenCalledTimes(2)
    expect(recordMessage).toHaveBeenNthCalledWith(1, botInfo, sentMessage('First message'))
    expect(recordMessage).toHaveBeenNthCalledWith(2, botInfo, sentMessage('Second message'))
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('clears the task when the model suppresses delivery', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    vi.mocked(generateText).mockResolvedValue(modelResult('{"messages":[]}'))

    await sendMessage(botContext, chatContext, 'Input', '-100', controller)

    expect(send).not.toHaveBeenCalled()
    expect(typing).not.toHaveBeenCalled()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('does not start work with an aborted controller', async () => {
    const { botContext, chatContext, send, controller } = createContext()
    const error = new Error('Stopped')
    controller.abort(error)

    await expect(sendMessage(botContext, chatContext, 'Input', '-100', controller)).rejects.toBe(error)

    expect(listJoinedChats).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('ignores model output that arrives after cancellation', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    const response = Promise.withResolvers<GenerateTextResult>()
    vi.mocked(generateText).mockReturnValue(response.promise)
    const result = sendMessage(botContext, chatContext, 'Input', '-100', controller).catch(error => error)
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce())
    const error = new Error('Stopped during model generation')

    controller.abort(error)
    await expect(result).resolves.toBe(error)
    response.resolve(modelResult('Late response'))
    await vi.runAllTimersAsync()

    expect(vi.mocked(generateText).mock.calls[0]?.[0].abortSignal?.aborted).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(typing).not.toHaveBeenCalled()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('stops after a pending typing request resolves despite cancellation', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    const response = Promise.withResolvers<true>()
    typing.mockReturnValue(response.promise)
    const result = sendMessage(botContext, chatContext, 'Input', '-100', controller).catch(error => error)
    await vi.waitFor(() => expect(typing).toHaveBeenCalledOnce())
    const error = new Error('Stopped during typing')

    controller.abort(error)
    await expect(result).resolves.toBe(error)
    response.resolve(true)
    await vi.runAllTimersAsync()

    expect(typing.mock.calls[0]?.[3]?.aborted).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('continues delivery when only the typing indicator fails', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    typing.mockRejectedValue(new Error('Typing unavailable'))
    const result = sendMessage(botContext, chatContext, 'Input', '-100', controller)
    await vi.waitFor(() => expect(typing).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()
    await result

    expect(send).toHaveBeenCalledOnce()
    expect(recordMessage).toHaveBeenCalledOnce()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('records an accepted message when cancellation races with its response', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    const response = Promise.withResolvers<Message.TextMessage>()
    vi.mocked(generateText).mockResolvedValue(modelResult('{"messages":["First", "Second"]}'))
    send.mockReturnValueOnce(response.promise)
    const result = sendMessage(botContext, chatContext, 'Input', '-100', controller).catch(error => error)
    await vi.waitFor(() => expect(typing).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()
    expect(send).toHaveBeenCalledOnce()
    const error = new Error('Stopped during delivery')

    controller.abort(error)
    await expect(result).resolves.toBe(error)
    response.resolve(sentMessage('First'))
    await vi.runAllTimersAsync()

    expect(send.mock.calls[0]?.[3]?.aborted).toBe(true)
    expect(recordMessage).toHaveBeenCalledExactlyOnceWith(botInfo, sentMessage('First'))
    expect(send).toHaveBeenCalledOnce()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('stops before the next message when cancellation arrives during recording', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    const recorded = Promise.withResolvers<void>()
    vi.mocked(recordMessage).mockReturnValueOnce(recorded.promise)
    vi.mocked(generateText).mockResolvedValue(modelResult('{"messages":["First", "Second"]}'))
    const result = sendMessage(botContext, chatContext, 'Input', '-100', controller).catch(error => error)
    await vi.waitFor(() => expect(typing).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()
    expect(recordMessage).toHaveBeenCalledOnce()
    const error = new Error('Stopped during recording')

    controller.abort(error)
    await expect(result).resolves.toBe(error)
    recorded.resolve()
    await vi.runAllTimersAsync()

    expect(send).toHaveBeenCalledOnce()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('clears the task when Telegram delivery fails', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    const error = new Error('Telegram request failed')
    send.mockRejectedValue(error)
    const result = sendMessage(botContext, chatContext, 'Input', '-100', controller).catch(error => error)
    await vi.waitFor(() => expect(typing).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe(error)
    expect(recordMessage).not.toHaveBeenCalled()
    expect(chatContext.currentTask).toBeUndefined()
  })

  it('keeps the replacement task after the canceled task settles', async () => {
    const { botContext, chatContext, send, typing, controller } = createContext()
    const firstResponse = Promise.withResolvers<GenerateTextResult>()
    const secondResponse = Promise.withResolvers<GenerateTextResult>()
    vi.mocked(generateText).mockReturnValueOnce(firstResponse.promise).mockReturnValueOnce(secondResponse.promise)
    const firstResult = sendMessage(botContext, chatContext, 'First input', '-100', controller).catch(error => error)
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce())
    const firstTask = chatContext.currentTask

    const secondResult = sendMessage(botContext, chatContext, 'Second input', '-100', new AbortController())
    const secondTask = chatContext.currentTask
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledTimes(2))
    await expect(firstResult).resolves.toEqual(new Error('CANCELLED'))
    firstResponse.resolve(modelResult('Stale message'))
    await vi.runAllTimersAsync()

    expect(firstTask).not.toBe(secondTask)
    expect(chatContext.currentTask).toBe(secondTask)
    expect(send).not.toHaveBeenCalled()
    expect(typing).not.toHaveBeenCalled()

    secondResponse.resolve(modelResult('Current message'))
    await vi.runAllTimersAsync()
    await secondResult

    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]?.[1]).toBe('Current message')
    expect(chatContext.currentTask).toBeUndefined()
  })
})
