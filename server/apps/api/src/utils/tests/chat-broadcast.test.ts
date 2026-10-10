import { describe, expect, it } from 'vitest'

import { createChatBroadcastMessage, parseChatBroadcastMessage } from '../chat-broadcast'

describe('chat broadcast utils', () => {
  it('creates a normalized broadcast message from validated inputs', () => {
    expect(createChatBroadcastMessage('user-1', {
      chatId: 'chat-1',
      messages: [{ id: 'msg-1' }],
      fromSeq: 3,
      toSeq: 4,
    }, 'instance-A')).toEqual({
      userId: 'user-1',
      payload: {
        chatId: 'chat-1',
        messages: [{ id: 'msg-1' }],
        fromSeq: 3,
        toSeq: 4,
      },
      originInstanceId: 'instance-A',
    })
  })

  it('rejects invalid publish-side identifiers', () => {
    expect(() => createChatBroadcastMessage('', {
      chatId: 'chat-1',
      messages: [],
      fromSeq: 1,
      toSeq: 1,
    }, 'instance-A')).toThrow('chat broadcast userId must be a non-empty string')

    expect(() => createChatBroadcastMessage('user-1', {
      chatId: 'chat-1',
      messages: [],
      fromSeq: 1,
      toSeq: 1,
    }, '')).toThrow('chat broadcast originInstanceId must be a non-empty string')
  })

  it('parses a valid broadcast message payload', () => {
    expect(parseChatBroadcastMessage(JSON.stringify({
      userId: 'user-2',
      payload: {
        chatId: 'chat-9',
        messages: ['message'],
        fromSeq: 9,
        toSeq: 12,
      },
      originInstanceId: 'instance-B',
    }))).toEqual({
      userId: 'user-2',
      payload: {
        chatId: 'chat-9',
        messages: ['message'],
        fromSeq: 9,
        toSeq: 12,
      },
      originInstanceId: 'instance-B',
    })
  })

  it('rejects invalid json and malformed payloads', () => {
    expect(() => parseChatBroadcastMessage('not-json')).toThrow('chat broadcast message is not valid JSON')
    expect(() => parseChatBroadcastMessage(JSON.stringify({
      userId: {},
      payload: {
        chatId: 'chat-1',
        messages: [],
        fromSeq: 1,
        toSeq: 1,
      },
      originInstanceId: 'instance-A',
    }))).toThrow('chat broadcast userId must be a non-empty string')
    expect(() => parseChatBroadcastMessage(JSON.stringify({
      userId: 'user-1',
      payload: {
        chatId: 'chat-1',
        messages: {},
        fromSeq: 1,
        toSeq: 1,
      },
      originInstanceId: 'instance-A',
    }))).toThrow('chat broadcast payload.messages must be an array')

    // Commit 88744602f.
    // ROOT CAUSE:
    // Redis loopback previously delivered local broadcasts twice.
    // Every message now carries originInstanceId. Receivers ignore their own broadcasts, and parsing rejects messages without an origin so stale publishers cannot bypass deduplication.
    expect(() => parseChatBroadcastMessage(JSON.stringify({
      userId: 'user-1',
      payload: {
        chatId: 'chat-1',
        messages: [],
        fromSeq: 1,
        toSeq: 1,
      },
    }))).toThrow('chat broadcast originInstanceId must be a non-empty string')
  })
})
