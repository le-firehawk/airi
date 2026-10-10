import type { Message } from 'grammy/types'

import type { chatMessagesTable } from '../db/schema'

import { findPhotoDescription } from './photos'
import { findStickerDescription } from './stickers'

type MessageSender
  = | { kind: 'user', id: string, name: string, displayName: string }
    | { kind: 'chat', id: string, name: string, displayName: string }
    | { kind: 'absent', id: undefined, name: string, displayName: string }

/**
 * Keeps chat identities separate from users and leaves absent sender IDs unset.
 * Telegram supplies synthetic users for messages sent on behalf of chats, so sender_chat takes precedence.
 */
export function resolveMessageSender(message: Pick<Message, 'from' | 'sender_chat'>): MessageSender {
  if (message.sender_chat) {
    const chat = message.sender_chat
    const name = chat.type === 'private' ? chat.first_name : chat.title
    return {
      kind: 'chat',
      id: chat.id.toString(),
      name,
      displayName: `Chat [Display name: ${name}${chat.username ? ` (username: ${chat.username})` : ''}]`,
    }
  }

  if (message.from) {
    const user = message.from
    return {
      kind: 'user',
      id: user.id.toString(),
      name: user.first_name,
      displayName: `User [Display name: ${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}${user.username ? ` (username: ${user.username})` : ''}]`,
    }
  }

  return { kind: 'absent', id: undefined, name: 'Unknown sender', displayName: 'Unknown sender' }
}

export function chatMessageToOneLine(botId: string, message: Omit<typeof chatMessagesTable.$inferSelect, 'content_vector_1536' | 'content_vector_768' | 'content_vector_1024'>, repliedToMessage?: Omit<typeof chatMessagesTable.$inferSelect, 'content_vector_1536' | 'content_vector_768' | 'content_vector_1024'>) {
  let userDisplayName = `Sender [${message.from_name}]`

  if (botId === message.from_id) {
    userDisplayName = 'Yourself'
  }

  if (message.is_reply) {
    if (repliedToMessage != null) {
      return `Message ID: ${message.platform_message_id || 'Unknown'} sent on ${new Date(message.created_at).toLocaleString()} ${userDisplayName} replied to ${repliedToMessage.from_name} with id ${repliedToMessage.platform_message_id} for content ${repliedToMessage.content} in same group said: ${message.content}`
    }

    return `Message ID: ${message.platform_message_id || 'Unknown'} sent on ${new Date(message.created_at).toLocaleString()} ${userDisplayName} replied to ${message.reply_to_name} with id ${message.reply_to_id} in same group said: ${message.content}`
  }

  return `Message ID: ${message.platform_message_id || 'Unknown'} sent on ${new Date(message.created_at).toLocaleString()} ${userDisplayName} sent in same group said: ${message.content}`
}

export async function telegramMessageToOneLine(botId: string, message: Message) {
  if (message == null) {
    return ''
  }

  const sentOn = new Date(message.date * 1000).toLocaleString()
  const sender = resolveMessageSender(message)
  const userDisplayName = sender.kind === 'user' && botId === sender.id ? 'Yourself' : sender.displayName
  const chatName = message.chat.type === 'private' ? message.chat.first_name : message.chat.title
  const chatDisplayName = `${message.chat.type === 'channel' ? 'Channel' : 'Chat'} [${chatName}]`
  // Non-text messages can carry captions. Service messages have no text to include.
  const text = message.text || message.caption || ''

  if (message.sticker != null) {
    const description = await findStickerDescription(message.sticker.file_id)
    return `Message ID: ${message.message_id || 'Unknown'} sent on ${sentOn} ${userDisplayName} sent in ${chatDisplayName} a sticker, and description of the sticker is ${description}`
  }
  if (message.photo != null) {
    const description = await findPhotoDescription(message.photo[0].file_id)
    return `Message ID: ${message.message_id || 'Unknown'} sent on ${sentOn} ${userDisplayName} sent in ${chatDisplayName} a photo, and description of the photo is ${description}`
  }
  if (message.reply_to_message != null) {
    const replySender = resolveMessageSender(message.reply_to_message)
    const replyContent = message.reply_to_message.text || message.reply_to_message.caption || ''
    if (replySender.kind === 'user' && botId === replySender.id) {
      return `Message ID: ${message.message_id || 'Unknown'} sent on ${sentOn} ${userDisplayName} replied to your previous message ${replyContent} in ${chatDisplayName} said: ${text}`
    }

    return `Message ID: ${message.message_id || 'Unknown'} sent on ${sentOn} ${userDisplayName} replied to ${replySender.displayName} for content ${replyContent} in ${chatDisplayName} said: ${text}`
  }

  return `Message ID: ${message.message_id || 'Unknown'} sent on ${sentOn} ${userDisplayName} sent in ${chatDisplayName} said: ${text}`
}
