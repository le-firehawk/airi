import type { MotionCommandResult } from './bus'
import type { MotionCommand } from './command'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { effectScope, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import settingsSource from '../../../../../i18n/src/locales/en/settings.yaml?raw'
import MotionLibrary from './motion-library.vue'

import { useSettingsStageModel } from '../../../stores/settings/stage-model'
import { getMotionBus, motionCommand, motionCommandResult } from './bus'
import { useVrmMotionHost } from './host'
import { useVrmMotionsStore } from './store'

const disposers: (() => void)[] = []

afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0))
    dispose()
})

async function setup() {
  const pinia = createPinia()
  const settings = useSettingsStageModel(pinia)
  settings.stageModelSelected = `library-test-${crypto.randomUUID()}`
  const requests: MotionCommand[] = []
  const unsubscribe = getMotionBus().on(motionCommand, ({ body }) => {
    if (body?.modelId === settings.stageModelSelected)
      requests.push(body)
  })
  const screen = render(MotionLibrary, {
    global: {
      plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: { settings: parse(settingsSource) } } })],
    },
  })
  await useVrmMotionsStore(pinia).loadPreferences(settings.stageModelSelected)
  await nextTick()
  disposers.push(() => {
    unsubscribe()
    disposePinia(pinia)
  })
  async function play() {
    const previous = requests.length
    await screen.getByRole('button', { name: 'Play', exact: true }).click()
    await vi.waitFor(() => expect(requests).toHaveLength(previous + 1))
    return requests.at(-1)!
  }
  function respond(request: MotionCommand, reason?: Extract<MotionCommandResult, { accepted: false }>['reason']) {
    const result = reason ? { accepted: false as const, reason } : { accepted: true as const }
    getMotionBus().emit(motionCommandResult, { modelId: request.modelId, requestId: request.requestId, ...result })
  }
  return { screen, settings, play, respond }
}

it('renders each request-local rejection as a specific translated status', async () => {
  const { screen, play, respond } = await setup()
  const cases = [
    ['not-ready', 'The model is not ready. Wait for it to load, then try again.'],
    ['manual-camera', 'Finish adjusting the camera before starting a motion.'],
    ['interaction-busy', 'Finish adjusting the camera or model, or choosing an orbit center, then try again.'],
    ['insufficient-room', 'This motion needs more room. Enlarge the model window or zoom out, then try again.'],
    ['queue-full', 'The motion queue is full. Stop playback to clear it.'],
    ['cancelled', 'This motion request was cancelled by another action.'],
    ['load-failed', 'This motion failed to load. Try again or import the animation again.'],
    ['unavailable', 'This motion is no longer available. Choose another motion.'],
    ['paused', 'Motion playback is paused. Resume playback, then try again.'],
    ['invalid-command', 'This motion request is invalid. Select the motion again.'],
  ] as const
  for (const [reason, message] of cases) {
    const request = await play()
    await expect.element(screen.getByRole('status')).toHaveTextContent('Waiting for the motion to load.')
    respond(request, reason)
    await expect.element(screen.getByRole('status')).toHaveTextContent(message)
  }
  respond(await play())
  await expect.element(screen.getByRole('status')).toHaveTextContent('Motion accepted.')
})

it('ignores previous requests and previous models while showing the current request result', async () => {
  const { screen, settings, play, respond } = await setup()
  const old = await play()
  const current = await play()
  respond(old, 'queue-full')
  await expect.element(screen.getByRole('status')).toHaveTextContent('Waiting for the motion to load.')
  respond(current, 'insufficient-room')
  await expect.element(screen.getByRole('status')).toHaveTextContent('This motion needs more room.')
  settings.stageModelSelected = `replacement-${crypto.randomUUID()}`
  await nextTick()
  const replacement = await play()
  respond(current, 'queue-full')
  await expect.element(screen.getByRole('status')).toHaveTextContent('Waiting for the motion to load.')
  respond(replacement)
  await expect.element(screen.getByRole('status')).toHaveTextContent('Motion accepted.')
})

it('shows the real host not-ready response when the sender and receiver share a renderer', async () => {
  const { screen, settings, play } = await setup()
  const scope = effectScope()
  scope.run(() => useVrmMotionHost({ modelId: () => settings.stageModelSelected, loadedModelId: undefined, controller: undefined }))
  disposers.push(() => scope.stop())
  await play()
  await expect.element(screen.getByRole('status')).toHaveTextContent('The model is not ready. Wait for it to load, then try again.')
})
