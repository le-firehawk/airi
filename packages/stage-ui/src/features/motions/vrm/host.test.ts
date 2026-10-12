import type { MotionPlayOptions } from '@proj-airi/stage-ui-three/motions'

import type { MotionCommandResult } from './bus'
import type { MotionCommand } from './command'

import { VRMCore, VRMHumanoid } from '@pixiv/three-vrm-core'
import { MotionController } from '@proj-airi/stage-ui-three/motions'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { AnimationClip, Box3, Group, Object3D, PerspectiveCamera, Vector3, VectorKeyframeTrack } from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'

import { getMotionBus, motionCommand, motionCommandResult } from './bus'
import { useVrmMotionHost } from './host'
import { defaultMotionPreferences } from './library'
import { useVrmMotionsStore } from './store'

function createController() {
  const scene = new Group()
  const hips = new Object3D()
  hips.name = 'Hips'
  hips.position.y = 1
  scene.add(hips)
  const head = new Object3D()
  head.position.y = 0.7
  hips.add(head)
  function bone() {
    const node = new Object3D()
    hips.add(node)
    return { node }
  }
  const humanoid = new VRMHumanoid({
    hips: { node: hips },
    head: { node: head },
    spine: bone(),
    leftUpperLeg: bone(),
    leftLowerLeg: bone(),
    leftFoot: bone(),
    rightUpperLeg: bone(),
    rightLowerLeg: bone(),
    rightFoot: bone(),
    leftUpperArm: bone(),
    leftLowerArm: bone(),
    leftHand: bone(),
    rightUpperArm: bone(),
    rightLowerArm: bone(),
    rightHand: bone(),
  })
  scene.add(humanoid.normalizedHumanBonesRoot)
  const vrm = new VRMCore({ scene, humanoid, meta: { metaVersion: '1', name: 'Test', authors: ['AIRI'], licenseUrl: 'https://opensource.org/license/mit' } })
  const root = new Group()
  root.add(scene)
  const normalized = humanoid.getNormalizedBoneNode('hips')!
  const rest = normalized.position.toArray()
  const clip = new AnimationClip('idle', 1, [new VectorKeyframeTrack(`${normalized.name}.position`, [0, 1], [...rest, ...rest])])
  const controller = new MotionController(vrm, clip, root)
  // Simple real clips exercise controller cancellation without depending on procedural rig completeness.
  for (const id of ['wave', 'bow', 'nod', 'present', 'celebrate'])
    controller.catalog.register({ id, name: id, duration: 1, category: 'gesture', loop: false, source: 'builtin' }, () => clip.clone())
  return controller
}

it('does not relabel the mounted avatar while a selected model URL is still resolving', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const scope = effectScope()
  const first = createController()
  const second = createController()
  const controller = shallowRef(first)
  const modelId = ref('avatar-a')
  const loadedModelId = ref<string | undefined>('avatar-a')
  // Node has no IndexedDB driver. Keep the real store and its caught, expected storage failures.
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const results: boolean[] = []
  const stopResults = getMotionBus().on(motionCommandResult, ({ body }) => {
    if (body?.requestId === 'selected-before-loaded')
      results.push(body.accepted)
  })
  try {
    const host = scope.run(() => useVrmMotionHost({ modelId, loadedModelId, controller }))!
    const store = useVrmMotionsStore()
    expect(await host.interact('wave')).toBe(true)
    expect(first.snapshot.activeId).toBe('wave')
    const beforeFitStop = host.motionRevision.value
    host.stop()
    expect(host.motionRevision.value).toBeGreaterThan(beforeFitStop)
    expect(first.snapshot.activeId).toBe(first.snapshot.idleId)

    await host.interact('bow')
    await host.interact('wave')
    const firstRevision = host.motionRevision.value
    modelId.value = 'avatar-b'
    expect(host.motionRevision.value).toBeGreaterThan(firstRevision)
    store.preferences['avatar-b'] = { ...defaultMotionPreferences(), idleId: 'bow', aiEnabled: true, aiMotionIds: ['nod'] }
    await nextTick()
    expect(first.snapshot.activeId).toBe(first.snapshot.idleId)
    expect(first.snapshot.idleId).toBe('default-idle')
    expect(await host.interact('bow')).toBeUndefined()
    host.act('nod')
    await getMotionBus().emit(motionCommand, { modelId: 'avatar-b', requestId: 'selected-before-loaded', type: 'play', motionId: 'wave', options: {} })
    expect(results).toEqual([false])
    expect(first.snapshot.activeId).toBe(first.snapshot.idleId)

    const pendingRevision = host.motionRevision.value
    modelId.value = 'avatar-a'
    expect(host.motionRevision.value).toBeGreaterThan(pendingRevision)
    const returnedRevision = host.motionRevision.value
    expect(await host.interact('nod')).toBe(true)
    expect(host.motionRevision.value).toBeGreaterThan(returnedRevision)
    modelId.value = 'avatar-b'

    controller.value = second
    loadedModelId.value = 'avatar-b'
    await nextTick()
    expect(await host.interact('nod')).toBe(true)
    expect(second.snapshot.activeId).toBe('nod')
    expect(first.snapshot.activeId).toBe('default-idle')
  }
  finally {
    stopResults()
    scope.stop()
    disposePinia(pinia)
    first.dispose()
    second.dispose()
    errors.mockRestore()
  }
})

it('returns the model-not-ready reason through the real command bus', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const scope = effectScope()
  const controller = createController()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const results: unknown[] = []
  const command: MotionCommand = { modelId: 'unloaded-avatar', requestId: 'not-ready', type: 'play', motionId: 'bow', options: {} }
  const unsubscribe = getMotionBus().on(motionCommandResult, ({ body }) => {
    if (body?.requestId === command.requestId)
      results.push(body)
  })
  try {
    scope.run(() => useVrmMotionHost({ modelId: command.modelId, loadedModelId: 'previous-avatar', controller }))
    await getMotionBus().emit(motionCommand, command)
    expect(results).toEqual([{ modelId: command.modelId, requestId: command.requestId, accepted: false, reason: 'not-ready' }])
  }
  finally {
    unsubscribe()
    scope.stop()
    disposePinia(pinia)
    controller.dispose()
    errors.mockRestore()
  }
})

const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0))
    cleanup()
  await Promise.resolve()
  vi.restoreAllMocks()
})

function setupHost() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const scope = effectScope()
  const controller = shallowRef(createController())
  const modelId = ref<string>(crypto.randomUUID())
  const loadedModelId = ref<string | undefined>(modelId.value)
  const paused = ref(false)
  const manipulationActive = ref(false)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const results: MotionCommandResult[] = []
  const unsubscribe = getMotionBus().on(motionCommandResult, ({ body }) => {
    if (body)
      results.push(body)
  })
  const host = scope.run(() => useVrmMotionHost({ modelId, loadedModelId, controller, paused, manipulationActive }))!
  cleanups.push(() => {
    unsubscribe()
    scope.stop()
    disposePinia(pinia)
    controller.value.dispose()
  })
  function send(motionId: string, options: MotionPlayOptions = {}) {
    const requestId = crypto.randomUUID()
    getMotionBus().emit(motionCommand, { modelId: modelId.value, requestId, type: 'play', motionId, options })
    return requestId
  }
  async function result(requestId: string) {
    await vi.waitFor(() => expect(results.some(result => result.requestId === requestId)).toBe(true))
    return results.find(result => result.requestId === requestId)!
  }
  return { controller, modelId, loadedModelId, paused, manipulationActive, host, results, send, result }
}

it.each(['not-ready', 'manual-camera', 'insufficient-room'] as const)('reports %s stage admission through the real host and bus', async (reason) => {
  const fixture = setupHost()
  const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
  camera.position.set(0, 0.9, reason === 'insufficient-room' ? 1 : 5)
  camera.lookAt(0, 0.9, 0)
  fixture.controller.value.setStageFrame({
    camera,
    root: new Group(),
    width: 1200,
    height: 900,
    manualControl: reason === 'manual-camera',
    bounds: reason === 'not-ready' ? undefined : new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2)),
  })
  expect(await fixture.result(fixture.send('bow'))).toMatchObject({ accepted: false, reason })
})

it('returns immediate unavailable-model replies after the sender records its request ID', async () => {
  const fixture = setupHost()
  fixture.loadedModelId.value = undefined
  let pending = ''
  const received: MotionCommandResult[] = []
  const unsubscribe = getMotionBus().on(motionCommandResult, ({ body }) => {
    if (body?.requestId === pending)
      received.push(body)
  })
  try {
    pending = useVrmMotionsStore().play(fixture.modelId.value, 'bow')
    await fixture.result(pending)
    expect(received).toEqual([{ modelId: fixture.modelId.value, requestId: pending, accepted: false, reason: 'not-ready' }])
  }
  finally {
    unsubscribe()
  }
})

it('distinguishes a full queue, blocked playback, and loader failure from stale controller errors', async () => {
  const fixture = setupHost()
  expect(await fixture.result(fixture.send('bow', { loop: true }))).toMatchObject({ accepted: true })
  for (let index = 0; index < 16; index++)
    expect(await fixture.result(fixture.send('wave', { mode: 'queue' }))).toMatchObject({ accepted: true })
  expect(await fixture.result(fixture.send('wave', { mode: 'queue' }))).toMatchObject({ accepted: false, reason: 'queue-full' })
  fixture.paused.value = true
  expect(await fixture.result(fixture.send('bow'))).toMatchObject({ accepted: false, reason: 'paused' })
  fixture.paused.value = false
  fixture.manipulationActive.value = true
  expect(await fixture.result(fixture.send('bow'))).toMatchObject({ accepted: false, reason: 'interaction-busy' })
  fixture.manipulationActive.value = false
  fixture.controller.value.catalog.register({ id: 'broken', name: 'Broken', category: 'gesture', duration: 1, source: 'imported', loop: false }, () => {
    throw new Error('broken file')
  })
  expect(await fixture.result(fixture.send('broken'))).toMatchObject({ accepted: false, reason: 'load-failed' })
  expect(await fixture.result(fixture.send('bow'))).toMatchObject({ accepted: true })
})

it('keeps a cancelled load separate from the replacement request rejection', async () => {
  const fixture = setupHost()
  fixture.controller.value.catalog.register({ id: 'slow', name: 'Slow', category: 'gesture', duration: 1, source: 'imported', loop: false }, () => new Promise<AnimationClip>(() => {}))
  const slow = fixture.send('slow')
  expect(fixture.controller.value.snapshot.loadingId).toBe('slow')
  const unavailable = fixture.send('missing')
  expect(await fixture.result(unavailable)).toMatchObject({ accepted: false, reason: 'unavailable' })
  expect(await fixture.result(slow)).toMatchObject({ accepted: false, reason: 'cancelled' })
  expect(fixture.controller.value.snapshot.error).toContain('not registered')
})

it('discards an old model load result after a new model takes ownership', async () => {
  const fixture = setupHost()
  const first = fixture.controller.value
  first.catalog.register({ id: 'slow', name: 'Slow', category: 'gesture', duration: 1, source: 'imported', loop: false }, () => new Promise<AnimationClip>(() => {}))
  const old = fixture.send('slow')
  fixture.modelId.value = 'replacement-avatar'
  fixture.loadedModelId.value = fixture.modelId.value
  fixture.controller.value = createController()
  await nextTick()
  expect(await fixture.result(fixture.send('missing'))).toMatchObject({ accepted: false, reason: 'unavailable' })
  expect(fixture.results.some(result => result.requestId === old)).toBe(false)
  first.dispose()
})

it('blocks catalog motions during orbit-center interaction and resumes when it ends', async () => {
  const fixture = setupHost()
  const entries = fixture.controller.value.catalog.list().filter(entry => entry.source === 'builtin' && entry.id !== 'relaxed-idle')
  fixture.manipulationActive.value = true
  for (const entry of entries)
    expect(await fixture.result(fixture.send(entry.id))).toMatchObject({ accepted: false, reason: 'interaction-busy' })
  fixture.manipulationActive.value = false
  for (const entry of entries)
    expect(await fixture.result(fixture.send(entry.id))).toMatchObject({ accepted: true })
})

it('rejects invalid options with the same correlation ID before controller playback', async () => {
  const fixture = setupHost()
  expect(await fixture.result(fixture.send('bow', { speed: Number.NaN }))).toMatchObject({ accepted: false, reason: 'invalid-command' })
  expect(fixture.controller.value.snapshot.activeId).toBe('default-idle')
})

it('reports cancellation for an explicit stop while a motion loads', async () => {
  const fixture = setupHost()
  fixture.controller.value.catalog.register({ id: 'slow-stop', name: 'Slow stop', category: 'gesture', duration: 1, source: 'imported', loop: false }, () => new Promise<AnimationClip>(() => {}))
  const pending = fixture.send('slow-stop')
  useVrmMotionsStore().stop(fixture.modelId.value)
  expect(await fixture.result(pending)).toMatchObject({ accepted: false, reason: 'cancelled' })
  expect(fixture.controller.value.snapshot.activeId).toBe('default-idle')
})
