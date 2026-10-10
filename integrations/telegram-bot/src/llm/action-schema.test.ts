import { describe, expect, it } from 'vitest'

import { parseGeneratedAction } from './action-schema'

describe('generated action validation', () => {
  it.each(['continue', 'break', 'sleep', 'list_chats', 'list_stickers'])('accepts %s without parameters', (action) => {
    expect(parseGeneratedAction({ action })).toEqual({ action })
  })

  it('preserves the message destination and content', () => {
    const action = { action: 'send_message', chatId: '123', content: 'Hello' }
    expect(parseGeneratedAction(action)).toEqual(action)
  })

  it('preserves history bounds', () => {
    const action = { action: 'read_history_messages', chatId: '123', beforeMessageId: '4', afterMessageId: '1' }
    expect(parseGeneratedAction(action)).toEqual(action)
  })

  it.each([null, {}, { action: 'unknown' }, { action: 'send_message', chatId: '123' }, { action: 'send_sticker', chatId: 123, fileId: 'x' }])('rejects invalid output %j', (input) => {
    expect(() => parseGeneratedAction(input)).toThrow()
  })
})
