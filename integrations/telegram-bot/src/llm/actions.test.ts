import type { GenerateTextResult } from '@xsai/generate-text'

import { generateText } from '@xsai/generate-text'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { imagineAnAction } from './actions'

vi.mock('@xsai/generate-text', () => ({ generateText: vi.fn() }))

function modelResult(text?: string): GenerateTextResult {
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
  return { text, usage, totalUsage: usage, finishReason: 'stop', messages: [], steps: [], toolCalls: [], toolResults: [] }
}

describe('imagineAnAction response guards', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('generates periodic actions without an incoming message', async () => {
    vi.mocked(generateText).mockResolvedValue(modelResult('{"action":"continue"}'))

    await expect(imagineAnAction('1', undefined, [], [], { unreadMessages: {} })).resolves.toEqual({ action: 'continue' })
    expect(JSON.stringify(vi.mocked(generateText).mock.calls[0][0].messages)).not.toContain('Incoming messages:')
  })

  it.each([undefined, '', '<think>Only reasoning</think>'])('rejects absent response content %j', async (text) => {
    vi.mocked(generateText).mockResolvedValue(modelResult(text))

    await expect(imagineAnAction('1', undefined, [], [], { unreadMessages: {} })).rejects.toThrow('No response text')
  })
})
