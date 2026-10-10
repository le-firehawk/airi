import type { Session, User } from 'better-auth'

import en from '@proj-airi/i18n/locales/en'
import OfficialProviderSpeechStreamingPage from '@proj-airi/stage-pages/pages/settings/providers/speech/official-provider-speech-streaming.vue'

import { errorMessageFrom } from '@moeru/std'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, routerKey } from 'vue-router'

import 'virtual:uno.css'

const providerId = 'official-provider-speech-streaming'

const user: User = {
  id: 'user-1',
  name: 'AIRI User',
  email: 'user@example.com',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const session: Session = {
  id: 'session-1',
  token: 'server-session-token',
  userId: user.id,
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
}

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: { en },
  })
}

function responseFor(input: RequestInfo | URL) {
  const url = typeof input === 'string'
    ? input
    : input instanceof Request
      ? input.url
      : input.toString()

  if (url.endsWith('/api/v1/flux')) {
    return new Response(JSON.stringify({ userId: user.id, flux: 42 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (url.includes('/api/v1/audio/models/streaming')) {
    return new Response(JSON.stringify({
      available: true,
      models: [{ id: 'volcengine/seed-tts-2.0', name: 'Seed TTS 2.0' }],
      default: 'volcengine/seed-tts-2.0',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (url.includes('/api/v1/audio/voices/streaming')) {
    return new Response(JSON.stringify({ voices: [], recommended: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  throw new Error(`Unexpected request: ${url}`)
}

async function renderPage(pinia = createPinia()) {
  setActivePinia(pinia)
  const errors: unknown[] = []
  const router = createTestRouter()

  await render(OfficialProviderSpeechStreamingPage, {
    global: {
      config: {
        errorHandler: error => errors.push(error),
      },
      directives: { motion: {} },
      plugins: [pinia, createTestI18n()],
      provide: { [routerKey as symbol]: router },
    },
  })

  return { errors, pinia }
}

describe('official streaming speech provider settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // https://airi.moeru.ai/settings/providers/speech/official-provider-speech-streaming
  it('does not request the protected catalog before authentication', async () => {
    const fetchMock = vi.fn<typeof fetch>(async input => responseFor(input))
    vi.stubGlobal('fetch', fetchMock)

    const { errors } = await renderPage()

    await expect.poll(() => errors.map(error => errorMessageFrom(error))).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ROOT CAUSE:
  // Lazy provider configuration left config.model unavailable on direct page load.
  // Wait for authentication and provider initialization, then apply server availability before loading voices.
  it('initializes provider configuration before it applies the server default model', async () => {
    const fetchMock = vi.fn<typeof fetch>(async input => responseFor(input))
    vi.stubGlobal('fetch', fetchMock)
    const pinia = createPinia()

    const { errors } = await renderPage(pinia)
    useAuthStore(pinia).$patch({ user, session })
    const providerConfigStore = useProviderConfigStore(pinia)

    await expect.poll(() => providerConfigStore.getProviderConfig(providerId)?.model).toBe('volcengine/seed-tts-2.0')
    await expect.poll(() => providerConfigStore.providers[providerId]?.status).toBe('configured')
    expect(errors.map(error => errorMessageFrom(error))).toEqual([])
    expect(fetchMock.mock.calls.some(([input]) => responseUrl(input).includes('/api/v1/audio/models/streaming'))).toBe(true)
    expect(fetchMock.mock.calls.some(([input]) => responseUrl(input).includes('/api/v1/audio/voices/streaming'))).toBe(true)
  })

  // https://github.com/moeru-ai/airi/pull/2440#discussion_r3912226728
  // ROOT CAUSE:
  // Electron routes forceProviderConfigured through its leader. Starting voice loading before that action completed left the provider unconfigured without another watcher trigger.
  // Await configuration before publishing local availability.
  it('waits for provider configuration before it loads streaming voices', async () => {
    const fetchMock = vi.fn<typeof fetch>(async input => responseFor(input))
    vi.stubGlobal('fetch', fetchMock)
    const pinia = createPinia()
    const { errors } = await renderPage(pinia)
    const actionOrder: string[] = []
    useProviderStore(pinia).$onAction(({ after, name }) => {
      if (name === 'forceProviderConfigured')
        after(() => actionOrder.push('configured'))
      if (name === 'listProviderVoices')
        actionOrder.push('voices')
    })

    useAuthStore(pinia).$patch({ user, session })
    await expect.poll(() => actionOrder).toEqual(['configured', 'voices'])
    expect(errors.map(error => errorMessageFrom(error))).toEqual([])
  })

  // https://github.com/moeru-ai/airi/pull/2440#discussion_r3912777731
  // ROOT CAUSE:
  // Discovery failure omits availability. Treating that absence as false hid an already configured provider.
  // Update provider state only when discovery returns explicit availability.
  it('preserves configured provider state when catalog discovery fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (responseUrl(input).includes('/api/v1/audio/models/streaming'))
        return new Response('upstream unavailable', { status: 502 })
      return responseFor(input)
    })
    vi.stubGlobal('fetch', fetchMock)
    const pinia = createPinia()

    const { errors } = await renderPage(pinia)
    const providerStore = useProviderStore(pinia)
    const providerConfigStore = useProviderConfigStore(pinia)
    providerConfigStore.ensureProvider(providerId, providerId, { model: 'volcengine/seed-tts-2.0' })
    providerConfigStore.setProviderStatus(providerId, 'configured')
    providerConfigStore.markProviderAdded(providerId)
    const setProviderUnconfigured = vi.spyOn(providerStore, 'setProviderUnconfigured')
    const setProviderAvailabilityOverride = vi.spyOn(providerStore, 'setProviderAvailabilityOverride')

    useAuthStore(pinia).$patch({ user, session })
    await expect.poll(() => providerStore.modelLoadError[providerId]).toContain('streaming models upstream 502')

    expect(setProviderAvailabilityOverride).not.toHaveBeenCalledWith(providerId, false)
    expect(setProviderUnconfigured).not.toHaveBeenCalledWith(providerId)
    expect(providerConfigStore.providers[providerId]?.status).toBe('configured')
    await expect.poll(() => fetchMock.mock.calls.some(([input]) => responseUrl(input).includes('/api/v1/audio/voices/streaming'))).toBe(true)
    expect(errors.map(error => errorMessageFrom(error))).toEqual([])
  })
})

function responseUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string')
    return input
  if (input instanceof Request)
    return input.url
  return input.toString()
}
