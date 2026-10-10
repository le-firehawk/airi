import type { GenerateTextOptions } from '@xsai/generate-text'
import type { Message } from 'grammy/types'

import type { BotContext, ChatContext } from '../../../../types'

import { env } from 'node:process'

import { useLogg } from '@guiiai/logg'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'
import { parse } from 'best-effort-json-parser'
import { delay, randomInt } from 'es-toolkit'

import { recordMessage } from '../../../../models'
import { listJoinedChats } from '../../../../models/chats'
import { messageSplit } from '../../../../prompts'
import { cancellable } from '../../../../utils/promise'
import { withTelegramAbortSignal } from '../../../../utils/telegram'

/**
 * Extracts message text and a reply target from model output. Plain text remains unchanged.
 * An explicit array without message text suppresses delivery.
 *
 * @example
 * parseMayStructuredMessage('{"messages":["Hello"]}')
 * // => { messages: ['Hello'], reply_to_message_id: undefined }
 */
export function parseMayStructuredMessage(responseText: string) {
  const logger = useLogg('parseMayStructuredMessage').useGlobalConfig()

  const result = /^\{.*\}$/msu.exec(responseText)
  if (result) {
    logger.withField('text', JSON.stringify(responseText)).withField('result', result).log('Multiple messages detected')

    const parsedResponse: unknown = parse(result[0])
    const structuredResponse = typeof parsedResponse === 'object' && parsedResponse !== null ? parsedResponse : undefined
    const responseMessages = structuredResponse && 'messages' in structuredResponse ? structuredResponse.messages : undefined
    const hasMessagesArray = Array.isArray(responseMessages)
    const messages = Array.isArray(responseMessages)
      ? responseMessages.filter((message): message is string => typeof message === 'string' && message.trim() !== '')
      : []
    const replyToMessageId = structuredResponse && 'reply_to_message_id' in structuredResponse && typeof structuredResponse.reply_to_message_id === 'string'
      ? structuredResponse.reply_to_message_id
      : undefined

    if (messages.length > 0) {
      return { messages, reply_to_message_id: replyToMessageId }
    }

    if (hasMessagesArray) {
      return null
    }

    return { messages: [responseText], reply_to_message_id: replyToMessageId }
  }

  return { messages: [responseText], reply_to_message_id: undefined }
}

/**
 * Owns one chat send sequence, from model generation through message recording.
 * A replacement cancels the previous sequence. Cancellation stops pending waits and API requests.
 * A confirmed Telegram delivery remains recorded, even if cancellation arrives during that request.
 */
export async function sendMessage(
  botContext: BotContext,
  chatContext: ChatContext,
  responseText: string,
  groupId: string,
  abortController: AbortController,
) {
  abortController.signal.throwIfAborted()
  chatContext.currentTask?.cancel()

  const task = cancellable(async (signal) => {
    const logger = useLogg('imagineAnAction').useGlobalConfig()
    const chat = (await listJoinedChats()).find(chat => chat.chat_id === groupId)
    signal.throwIfAborted()
    botContext.logger.withField('chat', chat).log('Chat found')
    if (!chat) {
      botContext.logger.withField('groupId', groupId).log('Chat not found')
      return
    }

    const chatId = chat.chat_id
    const systemContent = String(await messageSplit())
    signal.throwIfAborted()
    const req = {
      apiKey: env.LLM_API_KEY!,
      baseURL: env.LLM_API_BASE_URL!,
      model: env.LLM_MODEL!,
      messages: message.messages(
        { role: 'system', content: systemContent },
        { role: 'user', content: 'This is the input message:' },
        { role: 'user', content: responseText },
      ),
      abortSignal: signal,
    } satisfies GenerateTextOptions

    const res = await generateText(env.LLM_OLLAMA_DISABLE_THINK ? { ...req, think: false } : req)
    signal.throwIfAborted()
    if (!res.text) {
      throw new Error('No response text')
    }

    const text = res.text
      .replace(/<think>[\s\S]*?<\/think>/, '')
      .replace(/^```json\s*\n/, '')
      .replace(/\n```$/, '')
      .replace(/^```\s*\n/, '')
      .replace(/\n```$/, '')
      .trim()
    if (!text) {
      throw new Error('No response text')
    }

    logger.withFields({
      messages: responseText,
      response: text,
      now: new Date().toLocaleString(),
      totalTokens: res.usage.totalTokens,
      promptTokens: res.usage.inputTokens,
      completion_tokens: res.usage.outputTokens,
    }).log('Message split')

    const structuredMessage = parseMayStructuredMessage(text)
    if (structuredMessage == null) {
      botContext.logger.log(`Not sending message to ${chatId} - no messages to send`)
      return
    }

    botContext.logger.withField('texts', structuredMessage).log('Sending messages')
    for (const [index, item] of structuredMessage.messages.entries()) {
      signal.throwIfAborted()
      try {
        await withTelegramAbortSignal(signal, telegramSignal => botContext.bot.api.sendChatAction(chatId, 'typing', undefined, telegramSignal))
      }
      catch {
        // A failed typing indicator does not prevent delivery. Cancellation still stops the sequence.
        signal.throwIfAborted()
      }
      signal.throwIfAborted()
      await delay(item.length * 50, { signal })
      signal.throwIfAborted()

      const replyToMessageId = structuredMessage.reply_to_message_id ? Number.parseInt(structuredMessage.reply_to_message_id) : undefined
      const options = index === 0 && replyToMessageId && !Number.isNaN(replyToMessageId)
        ? { reply_parameters: { message_id: replyToMessageId } }
        : undefined

      let sentMessage: Message.TextMessage
      try {
        sentMessage = await withTelegramAbortSignal(signal, telegramSignal => botContext.bot.api.sendMessage(chatId, item, options, telegramSignal))
      }
      catch (error) {
        botContext.logger.withError(error).log('Failed to send message')
        throw error
      }

      // Telegram already accepted this message. Recording preserves history when cancellation races with the response.
      await recordMessage(botContext.bot.botInfo, sentMessage)
      signal.throwIfAborted()
      await delay(randomInt(50, 1000), { signal })
    }
  }, abortController.signal)

  chatContext.currentTask = task
  try {
    await task.promise
  }
  finally {
    // A canceled sequence cannot clear the task that replaced it.
    if (chatContext.currentTask === task) {
      chatContext.currentTask = undefined
    }
  }
}
