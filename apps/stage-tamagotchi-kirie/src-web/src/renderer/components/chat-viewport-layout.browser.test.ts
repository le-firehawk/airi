import type { ChatHistoryItem, StreamingAssistantMessage } from '@proj-airi/stage-ui/types/chat'

import en from '@proj-airi/i18n/locales/en'

import { ChatHistory } from '@proj-airi/stage-ui/components'
import { ScrollableArea } from '@proj-airi/ui'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import ChatViewportLayout from './chat-viewport-layout.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

function createEnglishI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: { en },
  })
}

describe('desktop chat viewport layout', () => {
  it('keeps history behind the fixed translucent composer', async () => {
    const TestHost = defineComponent(() => () => h(ChatViewportLayout, { style: 'height: 320px; width: 240px' }, {
      history: () => h(ScrollableArea, {
        type: 'always',
        viewportClass: 'chat-history-list',
        style: 'height: 100%; width: 100%',
      }, () => h('div', { style: 'height: 640px' }, 'Long chat history')),
      composer: () => h('div', { style: 'height: 80px' }, 'Fixed composer'),
    }))

    const screen = await render(TestHost)
    const layout = screen.getByTestId('chat-viewport-layout').element() as HTMLElement
    const historyLayer = screen.getByTestId('chat-history-layer').element() as HTMLElement
    const composer = screen.getByTestId('chat-composer-layer').element() as HTMLElement
    const history = screen.container.querySelector<HTMLElement>('.chat-history-list')
    const scrollbar = screen.container.querySelector<HTMLElement>('.scrollable-area-scrollbar--vertical')

    expect(history).not.toBeNull()
    expect(scrollbar).not.toBeNull()
    if (!history || !scrollbar)
      throw new Error('Expected the chat history viewport and its custom scrollbar.')

    await vi.waitFor(() => {
      expect(getComputedStyle(history).paddingBottom).toBe('16px')
      expect(Number.parseFloat(getComputedStyle(history, '::after').height)).toBeGreaterThan(80)
      expect(history.scrollHeight).toBeGreaterThan(history.clientHeight)
    })

    const layoutRect = layout.getBoundingClientRect()
    const historyRect = historyLayer.getBoundingClientRect()
    const composerRect = composer.getBoundingClientRect()
    expect(historyRect.top).toBe(layoutRect.top)
    expect(historyRect.right).toBe(layoutRect.right)
    expect(historyRect.bottom).toBe(layoutRect.bottom)
    expect(composerRect.top).toBeLessThan(historyRect.bottom)
    expect(getComputedStyle(history).borderRadius).toBe('0px')

    const scrollbarRect = scrollbar.getBoundingClientRect()
    expect(scrollbarRect.top).toBe(historyRect.top)
    expect(scrollbarRect.right).toBe(historyRect.right)
    expect(scrollbarRect.bottom).toBe(historyRect.bottom)
    expect(layoutRect.right - composerRect.right).toBe(16)

    const composerTop = composer.getBoundingClientRect().top
    history.scrollTop = 120
    history.dispatchEvent(new Event('scroll'))
    expect(composer.getBoundingClientRect().top).toBe(composerTop)
  })

  // https://github.com/moeru-ai/airi/pull/2489#discussion_r3967818100
  // ROOT CAUSE:
  //
  // The viewport spacer increases the native scroll range, but Virtua calculates
  // end alignment from item offsets that do not include that spacer. An automatic
  // tail scroll therefore leaves the final message behind the fixed composer.
  //
  // The Virtua scroll adapter must add the composer inset to end-aligned requests.
  it('keeps an automatically scrolled long-history tail above the fixed composer', async () => {
    const messages = shallowRef<ChatHistoryItem[]>(Array.from({ length: 40 }, (_, index) => ({
      id: `message-${index}`,
      role: 'user',
      content: `Message ${index}`,
    })))
    const sending = shallowRef(false)
    const streamingMessage = shallowRef<StreamingAssistantMessage>()
    const TestHost = defineComponent(() => () => h(ChatViewportLayout, { style: 'height: 320px; width: 240px' }, {
      history: ({ tailInset }: { tailInset: number }) => h(ChatHistory, {
        messages: messages.value,
        sending: sending.value,
        streamingMessage: streamingMessage.value,
        tailInset,
      }),
      composer: () => h('div', { style: 'height: 80px' }, 'Fixed composer'),
    }))

    const screen = await render(TestHost, {
      global: {
        plugins: [createEnglishI18n()],
      },
    })
    const composer = screen.getByTestId('chat-composer-layer').element() as HTMLElement

    async function expectVisibleTail(text: string) {
      await vi.waitFor(() => {
        const mountedMessages = screen.container.querySelectorAll<HTMLElement>('.chat-message-item')
        const finalMessage = [...mountedMessages].find(message => message.textContent?.includes(text))
        expect(finalMessage).not.toBeUndefined()
        expect(finalMessage!.getBoundingClientRect().bottom).toBeLessThanOrEqual(composer.getBoundingClientRect().top + 1)
      })
    }

    await expectVisibleTail('Message 39')

    messages.value = [...messages.value, {
      id: 'message-40',
      role: 'user',
      content: 'Appended tail',
    }]
    await expectVisibleTail('Appended tail')

    sending.value = true
    streamingMessage.value = {
      id: 'streaming-tail',
      role: 'assistant',
      content: 'Streaming tail',
      slices: [{ type: 'text', text: 'Streaming tail' }],
      tool_results: [],
    }
    await expectVisibleTail('Streaming tail')

    const expandedStreamText = 'Expanded streaming tail '.repeat(12)
    streamingMessage.value = {
      id: 'streaming-tail',
      role: 'assistant',
      content: expandedStreamText,
      slices: [{ type: 'text', text: expandedStreamText }],
      tool_results: [],
    }
    await expectVisibleTail('Expanded streaming tail')
  })

  // ROOT CAUSE:
  // Virtua short-list transforms do not increase scroll size, so a spacer cannot reveal messages hidden behind the composer.
  // Reserve the composer inset in the transform. Long histories use the viewport spacer.
  it('keeps a short virtualized history above the fixed composer', async () => {
    const messages: ChatHistoryItem[] = [{
      id: 'short-history-message',
      role: 'user',
      content: 'Short message',
    }]
    const TestHost = defineComponent(() => () => h(ChatViewportLayout, { style: 'height: 320px; width: 240px' }, {
      history: ({ tailInset }: { tailInset: number }) => h(ChatHistory, { messages, tailInset }),
      composer: () => h('div', { style: 'height: 80px' }, 'Fixed composer'),
    }))

    const screen = await render(TestHost, {
      global: {
        plugins: [createEnglishI18n()],
      },
    })
    const composer = screen.getByTestId('chat-composer-layer').element() as HTMLElement

    await vi.waitFor(() => {
      const message = screen.container.querySelector<HTMLElement>('.chat-message-item')
      expect(message).not.toBeNull()
      expect(message!.getBoundingClientRect().bottom).toBeLessThanOrEqual(composer.getBoundingClientRect().top)
    })
  })
})
