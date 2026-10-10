// @vitest-environment jsdom
import { streamFrom } from '@proj-airi/core-agent'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useProviderConfigStore } from '../providers/config'
import { useProviderStore } from '../providers/provider'
import { useConsciousnessStore } from './consciousness'
import { useConsciousnessSettingsStore } from './consciousness-settings'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('consciousness store provider selection', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  // ROOT CAUSE:
  // Default slider values were sent even when users had never configured sampling.
  // Explicit opt-in now separates saved values from active request parameters.
  // https://github.com/moeru-ai/airi/issues/2628
  it('leaves sampling parameters unset by default (Issue #2628)', () => {
    const store = useConsciousnessStore()

    expect(store.activeTemperature).toBeUndefined()
    expect(store.activeTopP).toBeUndefined()
  })

  it('does not treat previously saved sampling values as opt-in (Issue #2628)', () => {
    localStorage.setItem('settings/consciousness/active-temperature', '0.3')
    localStorage.setItem('settings/consciousness/active-top-p', '0.8')
    const store = useConsciousnessStore()

    expect(store.activeTemperature).toBeUndefined()
    expect(store.activeTopP).toBeUndefined()
  })

  it('sends only enabled sampling parameters and preserves zero values', async () => {
    const store = useConsciousnessStore()
    const settings = useConsciousnessSettingsStore()
    store.temperature = 0
    store.topP = 0.8
    const requests: Record<string, unknown>[] = []
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    async function send() {
      await streamFrom({
        model: 'test',
        chatProvider: { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.test/v1/', fetch } }) },
        conversation: { turns: [] },
        options: { temperature: store.activeTemperature, topP: store.activeTopP },
      })
    }

    await send()
    expect(requests[0]).not.toHaveProperty('temperature')
    expect(requests[0]).not.toHaveProperty('top_p')

    await settings.setTemperatureEnabled(true)
    await send()
    expect(requests[1].temperature).toBe(0)
    expect(requests[1]).not.toHaveProperty('top_p')

    await settings.setTemperatureEnabled(false)
    await settings.setTopPEnabled(true)
    await send()
    expect(requests[2]).not.toHaveProperty('temperature')
    expect(requests[2].top_p).toBe(0.8)

    await settings.setTopPEnabled(false)
    await send()
    expect(requests[3]).not.toHaveProperty('temperature')
    expect(requests[3]).not.toHaveProperty('top_p')
    expect(store.temperature).toBe(0)
    expect(store.topP).toBe(0.8)
  })

  it('restores explicit sampling opt-in and clears it when reset', async () => {
    localStorage.setItem('settings/consciousness/temperature-enabled', 'true')
    localStorage.setItem('settings/consciousness/top-p-enabled', 'true')
    localStorage.setItem('settings/consciousness/active-temperature', '0')
    localStorage.setItem('settings/consciousness/active-top-p', '0.8')
    const store = useConsciousnessStore()

    expect(store.activeTemperature).toBe(0)
    expect(store.activeTopP).toBe(0.8)

    await store.resetState()

    expect(store.activeTemperature).toBeUndefined()
    expect(store.activeTopP).toBeUndefined()
    expect(localStorage.getItem('settings/consciousness/temperature-enabled')).toBe('false')
    expect(localStorage.getItem('settings/consciousness/top-p-enabled')).toBe('false')
  })

  // ROOT CAUSE:
  // Model-listing checks used a throwing metadata lookup for an empty or unknown provider ID,
  // exposing an error on fresh installs.
  // They now inspect the definition registry without constructing executable metadata.
  // https://github.com/moeru-ai/airi/issues/1761
  it('reports no model listing support instead of throwing when no provider is selected (Issue #1761)', () => {
    const store = useConsciousnessStore()

    expect(store.activeProvider).toBe('')
    expect(() => store.supportsModelListing).not.toThrow()
    expect(store.supportsModelListing).toBe(false)
  })

  it('reports no model listing support for a stale provider id that no longer exists (Issue #1761)', () => {
    const store = useConsciousnessStore()

    store.activeProvider = 'provider-deleted-long-ago'

    expect(() => store.supportsModelListing).not.toThrow()
    expect(store.supportsModelListing).toBe(false)
  })

  it('findProviderDefinition returns known provider definitions', () => {
    const providersStore = useProviderStore()

    const definition = providersStore.findProviderDefinition('openai')

    expect(definition).toBeDefined()
    expect(definition?.id).toBe('openai')
  })

  it('findProviderDefinition returns undefined for empty and unknown ids', () => {
    const providersStore = useProviderStore()

    expect(providersStore.findProviderDefinition('')).toBeUndefined()
    expect(providersStore.findProviderDefinition('nope')).toBeUndefined()
  })

  it('resolves definitions through a configured provider instance id', () => {
    const providerStore = useProviderConfigStore()
    const providersStore = useProviderStore()
    providerStore.ensureProvider('custom-openai', 'openai', { apiKey: 'sk-test' })

    const definition = providersStore.findProviderDefinition('custom-openai')

    expect(definition?.id).toBe('openai')
    expect(definition?.name).toBe('OpenAI')
  })

  it('resolves chat providers with the current reasoning mode', async () => {
    const providerConfigStore = useProviderConfigStore()
    providerConfigStore.ensureProvider('openai', 'openai', { apiKey: 'sk-test' })
    const consciousnessStore = useConsciousnessStore()
    const settingsStore = useConsciousnessSettingsStore()

    const disabledProvider = await consciousnessStore.getChatProviderInstance('openai')
    // The provider only sends efforts supported by the selected catalog model.
    expect(disabledProvider.generation('gpt-5.1').config).toMatchObject({ reasoning: { effort: 'none' } })

    await settingsStore.setReasoning(true)

    const enabledProvider = await consciousnessStore.getChatProviderInstance('openai')
    expect(enabledProvider.generation('gpt-5.1').config).toMatchObject({ reasoning: { effort: 'medium', summary: 'auto' } })
    expect(enabledProvider.generation('test-model').config).not.toHaveProperty('reasoning')
  })

  // https://github.com/moeru-ai/airi/issues/2816
  // ROOT CAUSE:
  //
  // OpenRouter requests omit the reasoning override when the catalog has no
  // entry for the selected model, but the settings page still showed a toggle.
  // We fixed this by exposing the provider-default state and showing it in the UI.
  it('uses the OpenRouter default for a model that is missing from the catalog (Issue #2816)', async () => {
    const providerConfigStore = useProviderConfigStore()
    providerConfigStore.ensureProvider('openrouter-ai', 'openrouter-ai', { apiKey: 'test-key' })
    const consciousnessStore = useConsciousnessStore()
    consciousnessStore.activeProvider = 'openrouter-ai'
    consciousnessStore.activeModel = 'uncatalogued-model'

    expect(consciousnessStore.activeModelUsesProviderReasoningDefault).toBe(true)

    const provider = await consciousnessStore.getChatProviderInstance('openrouter-ai')
    expect(provider.generation('uncatalogued-model').config).not.toHaveProperty('reasoning')
  })

  // ROOT CAUSE:
  // Only the settings page reset models on provider changes. Onboarding, cards, and deletion
  // retained stale model IDs and caused model_not_found errors.
  // The store now owns that reset.
  // https://github.com/moeru-ai/airi/issues/1761
  it('clears the model selection when the provider changes (Issue #1761)', () => {
    const store = useConsciousnessStore()

    store.activeProvider = 'cerebras'
    store.activeModel = 'gpt-oss-120b'
    store.customModelName = 'custom-name'

    store.activeProvider = 'openai'

    expect(store.activeModel).toBe('')
    expect(store.customModelName).toBe('')
  })

  it('clears the model synchronously so callers can set a new one right after', () => {
    const store = useConsciousnessStore()

    store.activeProvider = 'cerebras'
    store.activeModel = 'gpt-oss-120b'

    // The set-provider-then-set-model sequence used by auth provider sync and
    // character cards must keep the newly assigned model.
    store.activeProvider = 'official-provider'
    store.activeModel = 'auto'

    expect(store.activeModel).toBe('auto')
  })

  it('keeps the persisted model when the provider stays the same', () => {
    const store = useConsciousnessStore()

    store.activeProvider = 'openai'
    store.activeModel = 'gpt-4o-mini'

    store.activeProvider = 'openai'

    expect(store.activeModel).toBe('gpt-4o-mini')
  })

  // ROOT CAUSE:
  // Pinia snapshots and storage events both updated live state. Stale storage events restored reset
  // models, causing endless reflected broadcasts.
  // localStorage is now one-way persistence. Only Pinia synchronization updates live state across
  // windows.
  it('does not apply storage events as a second cross-window state channel', async () => {
    const store = useConsciousnessStore()

    store.activeProvider = 'official-provider'
    store.activeModel = 'auto'
    await nextTick()

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'settings/consciousness/active-model',
      newValue: '',
      storageArea: localStorage,
    }))
    await nextTick()
    await nextTick()

    expect(store.activeModel).toBe('auto')
  })
})
