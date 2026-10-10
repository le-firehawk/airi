import type { GenerateTextResult } from '@xsai/generate-text'

import { generateText } from '@xsai/generate-text'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { imagineAnAction } from './llm-client'

vi.mock('@xsai/generate-text', () => ({ generateText: vi.fn() }))

function createResult(text: string | undefined): GenerateTextResult {
  return {
    finishReason: 'stop',
    messages: [],
    steps: [],
    text,
    toolCalls: [],
    toolResults: [],
    totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  }
}

beforeEach(() => {
  vi.mocked(generateText).mockReset()
})

describe('satori action generation', () => {
  it('accepts a periodic request without incoming events', async () => {
    vi.mocked(generateText).mockResolvedValue(createResult('{"action":"break"}'))

    const action = await imagineAnAction(undefined, [], [], { unreadEvents: {} })

    expect(action).toEqual({ action: 'break' })
    expect(generateText).toHaveBeenCalledOnce()
    const request = vi.mocked(generateText).mock.calls[0]?.[0]
    expect(request?.messages.at(-1)?.content).not.toContain('Incoming events:')
    expect(request?.messages.at(-1)?.content).toContain('You have total 0 unread events.')
  })

  it('keeps incoming event content in the request', async () => {
    vi.mocked(generateText).mockResolvedValue(createResult('{"action":"continue"}'))

    await imagineAnAction(undefined, [], [], {
      unreadEvents: {},
      incomingEvents: [{
        id: 1,
        type: 'message-created',
        platform: 'test',
        self_id: 'bot-1',
        timestamp: 1,
        channel: { id: 'channel-1', type: 0, name: 'General' },
        user: { id: 'user-1', name: 'Alice' },
        message: { id: 'message-1', content: 'Hello' },
      }],
    })

    const request = vi.mocked(generateText).mock.calls[0]?.[0]
    expect(request?.messages.at(-1)?.content).toContain('Incoming events:\n- [General] Alice: Hello')
  })

  it.each([undefined, '', '   ', '<think>Reasoning only</think>'])('rejects missing action text: %s', async (text) => {
    vi.mocked(generateText).mockResolvedValue(createResult(text))

    await expect(imagineAnAction(undefined, [], [], { unreadEvents: {} })).rejects.toThrow('No response text')
  })

  it('parses a fenced action after removing model reasoning', async () => {
    vi.mocked(generateText).mockResolvedValue(createResult('<think>Reasoning</think>\n```json\n{"action":"send_message","parameters":{"channelId":123,"content":"Hello"}}\n```'))

    const action = await imagineAnAction(undefined, [], [], { unreadEvents: {} })

    expect(action).toEqual({ action: 'send_message', channelId: '123', content: 'Hello' })
  })

  it('rejects an action that lacks its required content', async () => {
    vi.mocked(generateText).mockResolvedValue(createResult('{"action":"send_message","channelId":"123"}'))

    await expect(imagineAnAction(undefined, [], [], { unreadEvents: {} })).rejects.toThrow()
  })
})
