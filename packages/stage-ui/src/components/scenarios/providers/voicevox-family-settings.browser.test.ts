import type { Pinia } from 'pinia'

import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import VoicevoxFamilySettings from './voicevox-family-settings.vue'

import { useSpeechStore } from '../../../stores/modules/speech'
import { useProviderConfigStore } from '../../../stores/providers/config'

const ENGINE_SPEAKERS = [{
  name: 'ずんだもん',
  speaker_uuid: '388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',
  styles: [{ id: 3, name: 'ノーマル', type: 'talk' }],
}]

/** The page calls the engine over the ambient `fetch`, so that is the seam. */
function stubReachableEngine() {
  vi.stubGlobal('fetch', async (input: URL | RequestInfo) => {
    const endpoint = new URL(String(input)).pathname.split('/').pop()
    if (endpoint === 'version')
      return new Response('"0.24.1"')
    if (endpoint === 'speakers')
      return Response.json(ENGINE_SPEAKERS)

    throw new Error(`The settings page reached an unexpected endpoint: ${endpoint}`)
  })
}

function stubUnreachableEngine() {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })
}

async function mountSettings(pinia: Pinia, providerId = 'voicevox') {
  const i18n = createI18n({
    // Every label resolves to its own key. These cases assert on engine data and
    // on store state, so they need no message catalogue.
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: {} },
  })

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  await router.isReady()

  return await render(VoicevoxFamilySettings, {
    props: {
      providerId,
      intonationLabelKey: 'intonation.label',
      intonationDescriptionKey: 'intonation.description',
      defaultText: 'こんにちは',
    },
    global: {
      plugins: [pinia, PiniaColada, i18n, router],
      // The settings layout animates its header. The application installs the
      // motion plugin at its own entrypoint.
      directives: { motion: {} },
    },
  })
}

async function expectVoiceSettingsPersistence(providerId: 'voicevox' | 'aivis-speech') {
  stubReachableEngine()
  const pinia = createPinia()

  const screen = await mountSettings(pinia, providerId)
  const providerConfig = useProviderConfigStore(pinia)
  const sliders = screen.getByRole('slider').all()

  await sliders[0].fill('15000')

  await expect.poll(() => providerConfig.getProviderConfig(providerId)?.voiceSettings).toMatchObject({ speed: 1.5 })
  await expect.poll(() => {
    const stored = localStorage.getItem('settings/providers/configured')
    if (!stored)
      return undefined
    return JSON.parse(stored)[providerId]?.config?.voiceSettings?.speed
  }).toBe(1.5)
}

describe('voicevox family settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // ROOT CAUSE:
  // Keyless engines matched schema defaults, so shouldListProvider skipped validation. Their
  // unconfigured status blocked voice discovery.
  // The settings page now calls useProviderValidation, making the voice catalog and speech engine
  // available.
  it('loads the voice catalogue for a reachable engine', async () => {
    stubReachableEngine()
    const pinia = createPinia()

    const screen = await mountSettings(pinia)
    const providerConfig = useProviderConfigStore(pinia)
    const speech = useSpeechStore(pinia)

    await expect.poll(() => providerConfig.providers.voicevox?.status).toBe('configured')
    await expect.poll(() => speech.availableVoices.voicevox?.map(voice => voice.name)).toEqual(['ずんだもん / ノーマル'])
    await expect.element(screen.getByRole('button', { name: /Test/i })).toBeEnabled()
  })

  it('marks the provider invalid and loads no voices when the engine is unreachable', async () => {
    stubUnreachableEngine()
    const pinia = createPinia()

    await mountSettings(pinia)
    const providerConfig = useProviderConfigStore(pinia)
    const speech = useSpeechStore(pinia)

    await expect.poll(() => providerConfig.providers.voicevox?.status).toBe('invalid')
    expect(speech.availableVoices.voicevox).toBeUndefined()
  })

  // ROOT CAUSE:
  //
  // `SpeechProviderSettings` replaced an entry on the computed `configs` map.
  // The replacement did not update the full provider record, so local storage
  // kept the old voice settings.
  //
  // The shared component now updates configuration through the owning store.
  // https://github.com/moeru-ai/airi/issues/2449
  it('persists voice settings through the provider record (Issue #2449)', async () => {
    await expectVoiceSettingsPersistence('voicevox')
  })

  // https://github.com/moeru-ai/airi/issues/2449
  it('persists AivisSpeech voice settings through the provider record (Issue #2449)', async () => {
    await expectVoiceSettingsPersistence('aivis-speech')
  })

  // ROOT CAUSE:
  // A shallow credential copy retained nested voiceSettings proxies. Synchronized validation posted
  // them to the leader, where structuredClone rejected them.
  // Validation now receives a deep plain copy. This test checks cloneability directly because plain
  // Pinia has no synchronization wrapper.
  it('passes a structured-cloneable configuration to the synchronized validation action', async () => {
    stubReachableEngine()
    const pinia = createPinia()

    // The provider store calls `useI18n`. It therefore exists only inside the
    // mounted application, where a Pinia plugin can observe its actions.
    const validationArgs: unknown[][] = []
    pinia.use(({ store }) => {
      if (store.$id !== 'provider')
        return

      store.$onAction(({ args, name }) => {
        if (name === 'validateProviderConfig')
          validationArgs.push(args)
      })
    })

    await mountSettings(pinia)
    await vi.waitFor(() => expect(validationArgs.length).toBeGreaterThan(0))

    for (const args of validationArgs)
      expect(() => structuredClone(args)).not.toThrow()

    // A deep copy must keep the nested options, not drop them.
    const config = validationArgs[0][1] as { voiceSettings?: unknown }
    expect(config.voiceSettings).toEqual({ intonation: 1, pitch: 0, speed: 1, volume: 1 })
  })
})
