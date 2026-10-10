import type { Action } from '../types'

import { literal, object, optional, parse, string, variant } from 'valibot'

const actionSchema = variant('action', [
  object({ action: literal('continue') }),
  object({ action: literal('break') }),
  object({ action: literal('sleep') }),
  object({ action: literal('list_chats') }),
  object({ action: literal('list_stickers') }),
  object({ action: literal('send_message'), content: string(), chatId: string() }),
  object({ action: literal('send_sticker'), fileId: string(), chatId: string() }),
  object({ action: literal('search_google'), query: string() }),
  object({ action: literal('read_history_messages'), chatId: string(), beforeMessageId: optional(string()), afterMessageId: optional(string()) }),
  object({ action: literal('read_unread_messages'), chatId: string() }),
])

/** Validates normalized model output before the bot dispatches an action. */
export function parseGeneratedAction(input: unknown): Action {
  return parse(actionSchema, input)
}
