import type { VRMHumanBones } from '@pixiv/three-vrm-core'

import { VRMCore, VRMHumanoid } from '@pixiv/three-vrm-core'
import { AnimationClip, AnimationMixer, Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, NumberKeyframeTrack, Object3D, PerspectiveCamera, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { SceneMotionFraming } from '../companion/scene-motion-framing'
import { builtinMotionMetadata, createMotionCatalog, MotionCatalog, MotionController } from './index'

function createRig(scale = 1, bent = false) {
  const scene = new Group()
  function bone(parent: Object3D, name: string, x: number, y: number, z = 0) {
    const node = new Object3D()
    node.name = name
    node.position.set(x * scale, y * scale, z * scale)
    parent.add(node)
    return { node }
  }
  const hips = bone(scene, 'Hips', 0, 0.9)
  const spine = bone(hips.node, 'Spine', 0, 0.25)
  const chest = bone(spine.node, 'Chest', 0, 0.2)
  const neck = bone(chest.node, 'Neck', 0, 0.12)
  const head = bone(neck.node, 'Head', 0, 0.12)
  const leftUpperLeg = bone(hips.node, 'LeftUpperLeg', 0.09, 0)
  const leftLowerLeg = bone(leftUpperLeg.node, 'LeftLowerLeg', bent ? 0.01 : 0, -0.45, bent ? 0.03 : 0)
  const rightUpperLeg = bone(hips.node, 'RightUpperLeg', -0.09, 0)
  const rightLowerLeg = bone(rightUpperLeg.node, 'RightLowerLeg', bent ? -0.01 : 0, -0.45, bent ? 0.03 : 0)
  const leftUpperArm = bone(chest.node, 'LeftUpperArm', 0.2, 0.05)
  const leftLowerArm = bone(leftUpperArm.node, 'LeftLowerArm', 0.25, 0)
  const rightUpperArm = bone(chest.node, 'RightUpperArm', -0.2, 0.05)
  const rightLowerArm = bone(rightUpperArm.node, 'RightLowerArm', -0.25, 0)
  const bones: VRMHumanBones = {
    hips,
    spine,
    chest,
    neck,
    head,
    leftEye: bone(head.node, 'LeftEye', 0.03, 0.05, 0.08),
    rightEye: bone(head.node, 'RightEye', -0.03, 0.05, 0.08),
    jaw: bone(head.node, 'Jaw', 0, -0.03, 0.03),
    leftUpperLeg,
    leftLowerLeg,
    leftFoot: bone(leftLowerLeg.node, 'LeftFoot', 0, -0.4, bent ? -0.015 : 0),
    rightUpperLeg,
    rightLowerLeg,
    rightFoot: bone(rightLowerLeg.node, 'RightFoot', 0, -0.4, bent ? -0.015 : 0),
    leftUpperArm,
    leftLowerArm,
    leftHand: bone(leftLowerArm.node, 'LeftHand', 0.22, 0),
    rightUpperArm,
    rightLowerArm,
    rightHand: bone(rightLowerArm.node, 'RightHand', -0.22, 0),
  }
  const humanoid = new VRMHumanoid(bones)
  scene.add(humanoid.normalizedHumanBonesRoot)
  const vrm = new VRMCore({
    scene,
    humanoid,
    meta: { metaVersion: '1', name: 'Test rig', authors: ['AIRI'], licenseUrl: 'https://opensource.org/license/mit' },
  })
  const root = new Group()
  root.add(scene)
  const placement = new Group()
  placement.add(root)
  const normalizedHips = humanoid.getNormalizedBoneNode('hips')!
  const rest = normalizedHips.position.clone()
  const idle = new AnimationClip('original', 4, [new VectorKeyframeTrack(`${normalizedHips.name}.position`, [0, 4], [...rest.toArray(), ...rest.toArray()])])
  return { vrm, root, placement, hips: normalizedHips, idle }
}

function createController(scale = 1) {
  const rig = createRig(scale)
  const controller = new MotionController(rig.vrm, rig.idle, rig.root)
  return { ...rig, controller }
}

function advance(controller: MotionController, seconds: number) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60)
    controller.update(1 / 60)
}

describe('motion catalog', () => {
  it('lists hundreds of metadata entries without loading a clip', () => {
    const catalog = new MotionCatalog()
    const load = vi.fn()
    for (let index = 0; index < 600; index++) {
      catalog.register({ id: `motion-${index}`, name: `Motion ${index}`, category: 'gesture', duration: 2, loop: false, source: 'imported' }, load)
    }
    expect(catalog.list()).toHaveLength(600)
    expect(catalog.get('motion-599')?.name).toBe('Motion 599')
    expect(load).not.toHaveBeenCalled()
    const revision = catalog.getRevision('motion-0')
    catalog.register({ ...catalog.get('motion-0')!, name: 'Replaced' }, load)
    expect(catalog.getRevision('motion-0')).not.toBe(revision)
    catalog.unregister('motion-1')
    expect(catalog.list()).toHaveLength(599)
  })
})

describe('motion controller', () => {
  it('starts with the supplied idle and restores it after a selected idle', async () => {
    const { controller } = createController()
    expect(controller.snapshot.activeId).toBe('default-idle')
    expect(controller.snapshot.cachedClipCount).toBe(1)
    expect(await controller.setIdle('natural-idle')).toBe(true)
    expect(controller.snapshot.idleId).toBe('natural-idle')
    expect(controller.snapshot.activeId).toBe('natural-idle')
    expect(await controller.setIdle('default-idle')).toBe(true)
    expect(controller.snapshot.activeId).toBe('default-idle')
    controller.dispose()
  })

  it('returns to the selected idle after a one-shot and limits loops to 15 seconds', async () => {
    const { controller } = createController()
    await controller.setIdle('natural-idle')
    await controller.play('bow')
    expect(controller.snapshot.activeId).toBe('bow')
    advance(controller, 3)
    expect(controller.snapshot.activeId).toBe('natural-idle')
    await controller.play('dance')
    advance(controller, 14)
    expect(controller.snapshot.activeId).toBe('dance')
    advance(controller, 1.1)
    expect(controller.snapshot.activeId).toBe('natural-idle')
    controller.dispose()
  })

  it('finishes a one-shot at its clip duration when the maximum duration is longer', async () => {
    const { controller } = createController()
    await controller.play('bow', { loop: false, duration: 15 })
    advance(controller, 3)
    expect(controller.snapshot.activeId).toBe('default-idle')
    await controller.play('bow', { loop: false, duration: 15, speed: 2 })
    advance(controller, 1.5)
    expect(controller.snapshot.activeId).toBe('default-idle')
    controller.dispose()
  })

  it('queues at most 16 actions and advances them in order', async () => {
    const { controller } = createController()
    await controller.play('bow', { duration: 0.3 })
    expect(await controller.play('wave', { mode: 'queue', duration: 0.3 })).toBe(true)
    for (let index = 0; index < 15; index++)
      expect(await controller.play('nod', { mode: 'queue', duration: 0.3 })).toBe(true)
    expect(await controller.play('dance', { mode: 'queue' })).toBe(false)
    expect(controller.snapshot.queuedIds).toHaveLength(16)
    advance(controller, 0.4)
    await vi.waitFor(() => expect(controller.snapshot.activeId).toBe('wave'))
    expect(controller.snapshot.queuedIds).toHaveLength(15)
    advance(controller, 0.4)
    await vi.waitFor(() => expect(controller.snapshot.activeId).toBe('nod'))
    controller.stop()
    expect(controller.snapshot.queuedIds).toEqual([])
    expect(controller.snapshot.activeId).toBe('default-idle')
    controller.dispose()
  })

  it('plays a mixed queue of new actions and returns to the selected new idle', async () => {
    const { controller, root } = createController()
    try {
      expect(await controller.setIdle('thoughtful-idle')).toBe(true)
      expect(await controller.play('blow-kiss', { duration: 0.2 })).toBe(true)
      const queued = ['laugh', 'head-bob', 'walk-circle', 'shrug']
      for (const id of queued)
        expect(await controller.play(id, { mode: 'queue', duration: 0.2 })).toBe(true)
      expect(controller.snapshot.queuedIds).toEqual(queued)
      for (const id of queued) {
        advance(controller, 0.25)
        await vi.waitFor(() => expect(controller.snapshot.activeId).toBe(id))
      }
      advance(controller, 3)
      expect(controller.snapshot.activeId).toBe('thoughtful-idle')
      expect(controller.snapshot.queuedIds).toEqual([])
      expect(root.position.toArray()).toEqual([0, 0, 0])

      expect(await controller.play('walk-circle')).toBe(true)
      expect(await controller.play('blow-kiss', { mode: 'queue' })).toBe(true)
      expect(await controller.play('laugh', { mode: 'queue' })).toBe(true)
      advance(controller, 0.7)
      expect(root.position.length()).toBeGreaterThan(0)
      controller.stop()
      expect(controller.snapshot.activeId).toBe('thoughtful-idle')
      expect(controller.snapshot.queuedIds).toEqual([])
      advance(controller, 3)
      expect(root.position.toArray()).toEqual([0, 0, 0])
      expect(controller.snapshot.activeId).toBe('thoughtful-idle')
    }
    finally {
      controller.dispose()
    }
  })

  it('cancels a new procedural load and its queue when stop interrupts before playback', async () => {
    const { controller } = createController()
    try {
      expect(await controller.setIdle('attentive-idle')).toBe(true)
      const pending = controller.play('blow-kiss')
      const queued = controller.play('shrug', { mode: 'queue' })
      controller.stop()
      expect(await pending).toBe(false)
      expect(await queued).toBe(true)
      expect(controller.snapshot.loadingId).toBeUndefined()
      expect(controller.snapshot.queuedIds).toEqual([])
      advance(controller, 8)
      expect(controller.snapshot.activeId).toBe('attentive-idle')
    }
    finally {
      controller.dispose()
    }
  })

  it('does not let queued playback overtake a pending replacement load', async () => {
    const { controller, idle } = createController()
    let finish: (clip: AnimationClip) => void = () => {}
    controller.catalog.register({ id: 'slow', name: 'Slow', category: 'gesture', duration: 4, loop: false, source: 'imported' }, () => new Promise<AnimationClip>((resolve) => {
      finish = resolve
    }))
    await controller.play('bow', { duration: 0.2 })
    const replacement = controller.play('slow', { duration: 0.2 })
    await controller.play('wave', { mode: 'queue' })
    advance(controller, 0.4)
    expect(controller.snapshot.loadingId).toBe('slow')
    expect(controller.snapshot.queuedIds).toEqual(['wave'])
    finish(idle.clone())
    expect(await replacement).toBe(true)
    expect(controller.snapshot.activeId).toBe('slow')
    advance(controller, 0.4)
    await vi.waitFor(() => expect(controller.snapshot.activeId).toBe('wave'))
    controller.dispose()
  })

  it('skips failed queued loads and continues to the next action', async () => {
    const { controller } = createController()
    controller.catalog.register({ id: 'broken', name: 'Broken', category: 'gesture', duration: 1, loop: false, source: 'imported' }, async () => {
      throw new Error('Load failed')
    })
    await controller.play('bow', { duration: 0.2 })
    await controller.play('broken', { mode: 'queue' })
    await controller.play('wave', { mode: 'queue' })
    advance(controller, 0.4)
    await vi.waitFor(() => expect(controller.snapshot.activeId).toBe('wave'))
    expect(controller.snapshot.queuedIds).toEqual([])
    controller.dispose()
  })

  it('selects an imported idle without interrupting the current gesture', async () => {
    const { controller, idle } = createController()
    controller.catalog.register({ id: 'custom-idle', name: 'Custom idle', category: 'gesture', duration: 4, loop: false, source: 'imported' }, () => idle.clone())
    await controller.play('bow', { duration: 0.5 })
    expect(await controller.setIdle('custom-idle')).toBe(true)
    expect(controller.snapshot.activeId).toBe('bow')
    expect(controller.snapshot.idleId).toBe('custom-idle')
    advance(controller, 0.6)
    expect(controller.snapshot.activeId).toBe('custom-idle')
    advance(controller, 16)
    expect(controller.snapshot.activeId).toBe('custom-idle')
    expect(await controller.setIdle('run-circle')).toBe(false)
    controller.dispose()
  })

  it('cancels a pending request on stop without replay after its result arrives', async () => {
    const { controller, idle } = createController()
    let finish: (clip: AnimationClip) => void = () => {}
    controller.catalog.register({ id: 'slow', name: 'Slow', category: 'gesture', duration: 4, loop: false, source: 'imported' }, () => new Promise<AnimationClip>((resolve) => {
      finish = resolve
    }))
    const pending = controller.play('slow')
    await controller.play('wave', { mode: 'queue' })
    controller.stop()
    finish(idle.clone())
    expect(await pending).toBe(false)
    expect(controller.snapshot.activeId).toBe('default-idle')
    expect(controller.snapshot.loadingId).toBeUndefined()
    expect(controller.snapshot.queuedIds).toEqual([])
    controller.dispose()
  })

  it('crossfades into a body pose instead of snapping the rig', async () => {
    const { controller, vrm } = createController()
    const spine = vrm.humanoid.getNormalizedBoneNode('spine')!
    const before = spine.quaternion.clone()
    await controller.play('bow')
    expect(spine.quaternion.toArray()).toEqual(before.toArray())
    controller.update(1 / 60)
    expect(spine.quaternion.angleTo(before)).toBeLessThan(0.02)
    advance(controller, 1)
    expect(spine.rotation.x).toBeGreaterThan(0.5)
    const bowed = spine.quaternion.clone()
    controller.stop()
    expect(spine.quaternion.toArray()).toEqual(bowed.toArray())
    controller.update(1 / 60)
    expect(spine.quaternion.angleTo(bowed)).toBeLessThan(0.1)
    controller.dispose()
  })

  // The old full-idle fade restored untouched arms to the bind pose. A disjoint idle mask preserves those tracks.
  it('preserves the selected idle on unowned arms during a head-only motion', async () => {
    const { controller, vrm } = createController()
    await controller.setIdle('natural-idle')
    advance(controller, 0.5)
    const head = vrm.humanoid.getNormalizedBoneNode('head')!
    const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!
    const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')!
    const motion = new AnimationClip('head-only', 2, [new QuaternionKeyframeTrack(`${head.name}.quaternion`, [0, 2], [0.15, 0, 0, 0.988686, 0.15, 0, 0, 0.988686])])
    controller.catalog.register({ id: 'head-only', name: 'Head only', category: 'gesture', duration: 2, loop: false, source: 'imported' }, () => motion)
    await controller.play('head-only')
    for (let frame = 0; frame < 150; frame++) {
      controller.update(1 / 60)
      expect(leftArm.rotation.z).toBeLessThan(-1.2)
      expect(rightArm.rotation.z).toBeGreaterThan(1.2)
      if (frame === 60)
        expect(head.rotation.x).toBeCloseTo(0.3011, 3)
    }
    expect(controller.snapshot.activeId).toBe('natural-idle')
    controller.dispose()
  })

  it('keeps masked idle tracks at the idle phase and rate across fast motion loops', async () => {
    const { controller, vrm, hips } = createController()
    const reference = createController()
    await controller.setIdle('natural-idle')
    await reference.controller.setIdle('natural-idle')
    advance(controller, 0.5)
    advance(reference.controller, 0.5)
    const head = vrm.humanoid.getNormalizedBoneNode('head')!
    const arm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!
    const referenceArm = reference.vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!
    const motion = new AnimationClip('head-only', 0.6, [new QuaternionKeyframeTrack(`${head.name}.quaternion`, [0, 0.6], [0.15, 0, 0, 0.988686, 0.15, 0, 0, 0.988686])])
    controller.catalog.register({ id: 'head-only', name: 'Head only', category: 'gesture', duration: 0.6, loop: true, source: 'imported' }, () => motion)
    await controller.play('head-only', { loop: true, speed: 2, duration: 4 })
    for (let frame = 0; frame < 270; frame++) {
      controller.update(1 / 60)
      reference.controller.update(1 / 60)
      expect(arm.quaternion.angleTo(referenceArm.quaternion)).toBeLessThan(0.0001)
      expect(hips.position.distanceTo(reference.hips.position)).toBeLessThan(0.000001)
    }
    expect(controller.snapshot.activeId).toBe('natural-idle')
    controller.dispose()
    reference.controller.dispose()
  })

  it('preserves the unowned arm without averaging the owned arm with idle', async () => {
    const { controller, vrm } = createController()
    await controller.setIdle('natural-idle')
    advance(controller, 0.5)
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!
    const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')!
    const rotation = [0, 0, Math.sin(-0.1), Math.cos(-0.1)]
    const motion = new AnimationClip('one-arm', 2, [new QuaternionKeyframeTrack(`${left.name}.quaternion`, [0, 2], [...rotation, ...rotation])])
    controller.catalog.register({ id: 'one-arm', name: 'One arm', category: 'gesture', duration: 2, loop: false, source: 'imported' }, () => motion)
    await controller.play('one-arm')
    advance(controller, 0.5)
    expect(left.rotation.z).toBeCloseTo(-0.2, 5)
    expect(right.rotation.z).toBeGreaterThan(1.2)
    controller.stop()
    advance(controller, 0.5)
    expect(left.rotation.z).toBeLessThan(-1.2)
    expect(right.rotation.z).toBeGreaterThan(1.2)
    controller.dispose()
  })

  it('uses a new idle during active playback and when replaying a cached partial clip', async () => {
    const { controller, vrm } = createController()
    await controller.setIdle('natural-idle')
    advance(controller, 0.5)
    const head = vrm.humanoid.getNormalizedBoneNode('head')!
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!
    const right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')!
    const load = vi.fn(() => new AnimationClip('head-only', 4, [new QuaternionKeyframeTrack(`${head.name}.quaternion`, [0, 4], [0.15, 0, 0, 0.988686, 0.15, 0, 0, 0.988686])]))
    controller.catalog.register({ id: 'head-only', name: 'Head only', category: 'gesture', duration: 4, loop: false, source: 'imported' }, load)
    const leftRotation = [0, 0, Math.sin(-0.35), Math.cos(-0.35)]
    const rightRotation = [0, 0, Math.sin(0.35), Math.cos(0.35)]
    controller.catalog.register({ id: 'wide-idle', name: 'Wide idle', category: 'idle', duration: 3, loop: true, source: 'imported' }, () => new AnimationClip('wide-idle', 3, [
      new QuaternionKeyframeTrack(`${left.name}.quaternion`, [0, 3], [...leftRotation, ...leftRotation]),
      new QuaternionKeyframeTrack(`${right.name}.quaternion`, [0, 3], [...rightRotation, ...rightRotation]),
    ]))
    await controller.play('head-only')
    advance(controller, 0.5)
    const before = left.quaternion.clone()
    await controller.setIdle('wide-idle')
    expect(controller.snapshot.activeId).toBe('head-only')
    expect(left.quaternion.toArray()).toEqual(before.toArray())
    advance(controller, 0.5)
    expect(left.rotation.z).toBeCloseTo(-0.7, 5)
    expect(right.rotation.z).toBeCloseTo(0.7, 5)
    expect(head.rotation.x).toBeCloseTo(0.3011, 3)
    controller.stop()
    advance(controller, 0.5)
    await controller.play('head-only')
    advance(controller, 0.5)
    expect(load).toHaveBeenCalledTimes(1)
    expect(left.rotation.z).toBeCloseTo(-0.7, 5)
    expect(right.rotation.z).toBeCloseTo(0.7, 5)
    expect(head.rotation.x).toBeCloseTo(0.3011, 3)
    controller.dispose()
  })

  it('bounds temporary idle masks and releases their mixer actions and bindings', async () => {
    const { controller, vrm } = createController()
    await controller.setIdle('natural-idle')
    advance(controller, 0.5)
    const head = vrm.humanoid.getNormalizedBoneNode('head')!
    const source = new AnimationClip('head-only', 4, [new QuaternionKeyframeTrack(`${head.name}.quaternion`, [0, 4], [0.15, 0, 0, 0.988686, 0.15, 0, 0, 0.988686])])
    const actionCalls = vi.spyOn(controller.mixer, 'clipAction')
    for (let index = 0; index < 40; index++) {
      controller.catalog.register({ id: `head-${index}`, name: `Head ${index}`, category: 'gesture', duration: 4, loop: false, source: 'imported' }, () => source)
      await controller.play(`head-${index}`)
      expect(controller.snapshot.cachedClipCount).toBeLessThanOrEqual(8)
      expect(controller.mixer.stats.actions.total).toBeLessThanOrEqual(18)
      expect(controller.mixer.stats.actions.inUse).toBeLessThanOrEqual(10)
    }
    const masks = actionCalls.mock.calls.map(([clip]) => clip).filter((clip): clip is AnimationClip => clip instanceof AnimationClip && clip.name === 'masked-idle')
    expect(masks).toHaveLength(40)
    const bodyTrackCount = Object.keys(vrm.humanoid.normalizedHumanBones).filter(name => !['leftEye', 'rightEye', 'jaw'].includes(name)).length + 1
    expect(controller.mixer.stats.bindings.total).toBeLessThanOrEqual(bodyTrackCount)
    advance(controller, 0.5)
    expect(controller.mixer.stats.actions.total).toBeLessThanOrEqual(9)
    for (const clip of masks.slice(0, -1))
      expect(controller.mixer.existingAction(clip)).toBeNull()
    controller.stop()
    advance(controller, 0.5)
    expect(controller.mixer.stats.actions.inUse).toBe(1)
    expect(controller.mixer.stats.actions.total).toBeLessThanOrEqual(8)
    for (const clip of masks)
      expect(controller.mixer.existingAction(clip)).toBeNull()
    await controller.play('head-39')
    controller.reset()
    expect(controller.mixer.stats.actions.inUse).toBe(1)
    expect(controller.mixer.stats.actions.total).toBeLessThanOrEqual(8)
    await controller.play('head-39')
    controller.dispose()
    expect(controller.snapshot.cachedClipCount).toBe(0)
    expect(controller.mixer.stats.actions.total).toBe(0)
    expect(controller.mixer.stats.bindings.total).toBe(0)
    actionCalls.mockRestore()
  })

  it('preserves the weighted body pose when stop interrupts an unfinished crossfade', async () => {
    const { controller, vrm } = createController()
    const elbow = vrm.humanoid.getNormalizedBoneNode('rightLowerArm')!
    const idle = await createMotionCatalog().load('natural-idle', vrm, new AbortController().signal)
    const rotation = [0, 0, Math.sin(0.65), Math.cos(0.65)]
    idle.tracks = idle.tracks.filter(track => track.name !== `${elbow.uuid}.quaternion`)
    idle.tracks.push(new QuaternionKeyframeTrack(`${elbow.uuid}.quaternion`, [0, idle.duration], [...rotation, ...rotation]))
    controller.catalog.register({ id: 'bent-idle', name: 'Bent idle', category: 'idle', duration: idle.duration, loop: true, source: 'imported' }, () => idle)
    const actionCalls = vi.spyOn(controller.mixer, 'clipAction')
    await controller.setIdle('bent-idle')
    const selectedClip = actionCalls.mock.calls[0][0]
    if (!(selectedClip instanceof AnimationClip))
      throw new Error('The selected idle did not create an animation clip.')
    const idleAction = controller.mixer.existingAction(selectedClip)!
    advance(controller, 0.5)
    await controller.play('bow')
    for (let frame = 0; frame < 7; frame++)
      controller.update(1 / 60)
    const before = elbow.quaternion.clone()
    const weight = idleAction.getEffectiveWeight()
    expect(weight).toBeCloseTo(1 - 7 / 18, 5)
    controller.stop()
    expect(idleAction.getEffectiveWeight()).toBeCloseTo(weight, 5)
    expect(elbow.quaternion.toArray()).toEqual(before.toArray())
    controller.update(1 / 60)
    expect(idleAction.getEffectiveWeight()).toBeCloseTo(weight + (1 - weight) / 18, 5)
    expect(elbow.quaternion.angleTo(before)).toBeLessThan(0.08)
    advance(controller, 0.5)
    expect(elbow.rotation.z).toBeCloseTo(1.3, 5)
    controller.dispose()
    actionCalls.mockRestore()
  })

  it('restarts a weighted cached clip through a separate instance without resetting the live pose', async () => {
    const { controller, vrm } = createController()
    await controller.setIdle('natural-idle')
    advance(controller, 0.5)
    const head = vrm.humanoid.getNormalizedBoneNode('head')!
    const load = vi.fn(() => new AnimationClip('head-turn', 2, [new QuaternionKeyframeTrack(`${head.name}.quaternion`, [0, 2], [0, 0, 0, 1, Math.sin(0.4), 0, 0, Math.cos(0.4)])]))
    controller.catalog.register({ id: 'head-turn', name: 'Head turn', category: 'gesture', duration: 2, loop: false, source: 'imported' }, load)
    await controller.play('head-turn')
    advance(controller, 1)
    const before = head.quaternion.clone()
    await controller.play('head-turn')
    expect(head.quaternion.toArray()).toEqual(before.toArray())
    controller.update(1 / 60)
    expect(head.quaternion.angleTo(before)).toBeLessThan(0.04)
    advance(controller, 0.5)
    expect(head.rotation.x).toBeGreaterThan(0.19)
    expect(head.rotation.x).toBeLessThan(0.24)
    expect(load).toHaveBeenCalledTimes(1)
    controller.stop()
    advance(controller, 0.5)
    expect(controller.mixer.stats.actions.total).toBeLessThanOrEqual(controller.snapshot.cachedClipCount)
    controller.dispose()
    expect(controller.mixer.stats.bindings.total).toBe(0)
  })

  it('preserves relaxed arms through rapid replacement and a second interrupted stop', async () => {
    const { controller, vrm } = createController()
    await controller.setIdle('natural-idle')
    advance(controller, 0.5)
    const arm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!
    await controller.play('bow')
    for (let frame = 0; frame < 7; frame++)
      controller.update(1 / 60)
    const before = arm.quaternion.clone()
    await controller.play('nod')
    controller.update(1 / 60)
    expect(arm.quaternion.angleTo(before)).toBeLessThan(0.04)
    controller.stop()
    for (let frame = 0; frame < 40; frame++) {
      const previous = arm.quaternion.clone()
      controller.update(1 / 60)
      expect(arm.quaternion.angleTo(previous)).toBeLessThan(0.04)
      expect(arm.rotation.z).toBeLessThan(-1.2)
    }
    expect(controller.snapshot.activeId).toBe('natural-idle')
    controller.dispose()
  })

  it('keeps at most eight cached clips and reloads an evicted clip', async () => {
    const { controller, idle } = createController()
    const first = vi.fn(() => idle.clone())
    for (let index = 0; index < 40; index++) {
      controller.catalog.register({ id: `clip-${index}`, name: `Clip ${index}`, category: 'gesture', duration: 4, loop: false, source: 'imported' }, index === 0 ? first : () => idle.clone())
      expect(await controller.play(`clip-${index}`)).toBe(true)
      expect(controller.snapshot.cachedClipCount).toBeLessThanOrEqual(8)
    }
    await controller.play('clip-0')
    expect(first).toHaveBeenCalledTimes(2)
    expect(controller.snapshot.cachedClipCount).toBeLessThanOrEqual(8)
    controller.dispose()
  })

  it('rejects a stale load after replacement without caching or playing it', async () => {
    const { controller, idle } = createController()
    let finish: (clip: AnimationClip) => void = () => {}
    let signal: AbortSignal | undefined
    controller.catalog.register({ id: 'slow', name: 'Slow', category: 'gesture', duration: 4, loop: false, source: 'imported' }, (_vrm, requestSignal) => {
      signal = requestSignal
      return new Promise<AnimationClip>((resolve) => {
        finish = resolve
      })
    })
    const pending = controller.play('slow')
    expect(controller.snapshot.loadingId).toBe('slow')
    await controller.play('bow')
    const count = controller.snapshot.cachedClipCount
    finish(idle.clone())
    expect(await pending).toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(controller.snapshot.activeId).toBe('bow')
    expect(controller.snapshot.cachedClipCount).toBe(count)
    controller.dispose()
  })

  it('rejects a load when its catalog entry changes', async () => {
    const { controller, idle } = createController()
    let finish: (clip: AnimationClip) => void = () => {}
    const metadata = { id: 'replaced', name: 'Replaced', category: 'gesture', duration: 4, loop: false, source: 'imported' } as const
    controller.catalog.register(metadata, () => new Promise<AnimationClip>((resolve) => {
      finish = resolve
    }))
    const pending = controller.play('replaced')
    controller.catalog.register(metadata, () => idle.clone())
    finish(idle.clone())
    expect(await pending).toBe(false)
    expect(controller.snapshot.activeId).toBe('default-idle')
    expect(controller.snapshot.error).toContain('failed to load')
    expect(await controller.play('replaced')).toBe(true)
    controller.dispose()
  })

  it('resolves canceled playback even when its loader ignores abort and never settles', async () => {
    const { controller } = createController()
    controller.catalog.register({ id: 'stalled', name: 'Stalled', category: 'gesture', duration: 4, loop: false, source: 'imported' }, () => new Promise<AnimationClip>(() => {}))
    const pending = controller.play('stalled')
    controller.stop()
    expect(await pending).toBe(false)
    expect(controller.snapshot.loadingId).toBeUndefined()
    controller.dispose()
  })

  it('aborts playback and idle loads on disposal and ignores late results', async () => {
    const { controller, idle } = createController()
    const finishes: ((clip: AnimationClip) => void)[] = []
    const signals: AbortSignal[] = []
    controller.catalog.register({ id: 'slow', name: 'Slow', category: 'idle', duration: 4, loop: true, source: 'imported' }, (_vrm, signal) => {
      signals.push(signal)
      return new Promise<AnimationClip>(resolve => finishes.push(resolve))
    })
    const playback = controller.play('slow')
    const selection = controller.setIdle('slow')
    controller.dispose()
    for (const finish of finishes)
      finish(idle.clone())
    expect(await playback).toBe(false)
    expect(await selection).toBe(false)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(controller.snapshot.cachedClipCount).toBe(0)
    expect(await controller.play('bow')).toBe(false)
    controller.update(1)
  })

  it('keeps the selected idle when an idle load fails', async () => {
    const { controller } = createController()
    controller.catalog.register({ id: 'broken', name: 'Broken', category: 'idle', duration: 4, loop: true, source: 'imported' }, async () => {
      throw new Error('Network error')
    })
    expect(await controller.setIdle('broken')).toBe(false)
    expect(controller.snapshot.idleId).toBe('default-idle')
    expect(controller.snapshot.activeId).toBe('default-idle')
    expect(controller.snapshot.error).toContain('failed to load')
    controller.dispose()
  })

  it('restores the saved idle requested before bounds are ready and cancels an obsolete selection', async () => {
    const { controller, placement } = createController()
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
    camera.position.set(0, 0.9, 5)
    camera.lookAt(0, 0.9, 0)
    const frame = { camera, root: placement, width: 1200, height: 900, manualControl: false }
    controller.setStageFrame(frame)
    expect(await controller.setIdle('default-idle')).toBe(true)
    expect(controller.snapshot.error).toBeUndefined()
    const obsolete = controller.setIdle('natural-idle')
    await Promise.resolve()
    const selected = controller.setIdle('natural-idle')
    await Promise.resolve()
    controller.setStageFrame({ ...frame, bounds: new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2)) })
    expect(await obsolete).toBe(false)
    expect(await selected).toBe(true)
    expect(controller.snapshot.idleId).toBe('natural-idle')
    expect(controller.snapshot.error).toBeUndefined()
    controller.dispose()
  })

  it('cancels an idle waiting for initial bounds when the model is disposed', async () => {
    const { controller, placement } = createController()
    controller.setStageFrame({ camera: new PerspectiveCamera(), root: placement, width: 800, height: 600, manualControl: false })
    const pending = controller.setIdle('natural-idle')
    await Promise.resolve()
    controller.dispose()
    expect(await pending).toBe(false)
  })

  it('reuses load-time world bounds under a rotated scaled parent and after a cached reset', async () => {
    const { controller, placement } = createController()
    placement.position.set(0.2, -0.1, 0.3)
    placement.rotation.set(0.04, 0.4, -0.03)
    placement.scale.set(1.1, 0.9, 1.2)
    placement.updateMatrixWorld(true)
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
    camera.position.set(0, 0.9, 8)
    camera.lookAt(0, 0.9, 0)
    const frame = { camera, root: placement, width: 1200, height: 900, manualControl: false }
    controller.setStageFrame(frame)
    const local = new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2))
    const world = local.clone().applyMatrix4(placement.matrixWorld)
    const original = world.clone()
    controller.setLoadedStageBounds(world)
    expect(world.equals(original)).toBe(true)
    expect(await controller.play('run-circle')).toBe(true)
    advance(controller, 0.5)
    controller.reset()
    const replacementCamera = camera.clone()
    controller.setStageFrame({ ...frame, camera: replacementCamera })
    controller.setLoadedStageBounds(world)
    expect(await controller.play('run-circle')).toBe(true)
    expect(controller.snapshot.error).toBeUndefined()
    controller.dispose()
  })

  it('revalidates a cached selected imported idle against a replacement camera', async () => {
    const { controller, idle, placement } = createController()
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
    camera.position.set(0, 0.9, 20)
    camera.lookAt(0, 0.9, 0)
    const frame = { camera, root: placement, width: 1200, height: 900, manualControl: false }
    const bounds = new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2))
    controller.setStageFrame({ ...frame, bounds })
    controller.catalog.register({ id: 'wide-idle', name: 'Wide idle', category: 'idle', duration: 4, loop: true, source: 'imported' }, () => idle.clone())
    expect(await controller.setIdle('wide-idle')).toBe(true)
    controller.reset()
    const closeCamera = camera.clone()
    closeCamera.position.z = 2
    controller.setStageFrame({ ...frame, camera: closeCamera })
    controller.setLoadedStageBounds(bounds)
    expect(controller.snapshot.idleId).toBe('default-idle')
    expect(await controller.setIdle('wide-idle')).toBe(false)
    expect(controller.snapshot.error).toContain('needs more room')
    controller.dispose()
  })

  it('retains ownership of a gesture camera offset through circle travel and restores it only after returning', async () => {
    const { controller, root, placement } = createController()
    const mesh = new Mesh(new BoxGeometry(0.6, 1.7, 0.4), new MeshBasicMaterial())
    mesh.position.y = 0.85
    root.add(mesh)
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
    camera.position.set(0, 0.9, 5)
    camera.lookAt(0, 0.9, 0)
    const baseline = camera.position.clone()
    const stage = { camera, root: placement, width: 1200, height: 900, manualControl: false }
    const bounds = new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2))
    controller.setStageFrame({ ...stage, bounds })
    vi.useFakeTimers({ toFake: ['performance'] })
    try {
      const framing = new SceneMotionFraming('movement', { maxZoomOut: 2.5 })
      const frame = { modelId: 'movement', motionRevision: 0, cameraRevision: 0, manualControl: false, root: placement, camera, anchorWorld: new Vector3(0, 0.9, 0), nowMs: 0, motionActive: false }
      framing.tick(frame)
      expect(await controller.play('bow')).toBe(true)
      const expanded = bounds.clone().expandByScalar(1)
      const gesture = framing.tick({ ...frame, nowMs: 200, motionActive: true, motionRevision: 1, motionEnvelope: expanded })
      expect(gesture.status).toBe('applied')
      expect(camera.position.distanceTo(baseline)).toBeGreaterThan(0.1)
      const temporaryCamera = camera.position.clone()
      controller.setStageFrame(stage)
      expect(await controller.play('run-circle')).toBe(true)
      for (let tick = 0; tick < 180; tick++) {
        controller.update(1 / 60)
        expect(controller.stageMovementActive).toBe(true)
        // ThreeScene skips framing while this predicate owns travel and its return.
        controller.setStageFrame(stage)
        expect(camera.position.toArray()).toEqual(temporaryCamera.toArray())
      }
      controller.stop()
      expect(controller.stageMovementActive).toBe(true)
      advance(controller, 4)
      expect(controller.stageMovementActive).toBe(false)
      for (let tick = 0; tick < 240; tick++)
        framing.tick({ ...frame, nowMs: 8000 + tick * 1000 / 60, motionRevision: 2 })
      expect(camera.position.distanceTo(baseline)).toBeLessThan(0.000001)
    }
    finally {
      controller.dispose()
      mesh.geometry.dispose()
      mesh.material.dispose()
      vi.useRealTimers()
    }
  })

  it('keeps gait-coupled travel consistent when the placement and camera scale together', async () => {
    const fixtures = [createController(), createController()]
    for (let index = 0; index < fixtures.length; index++) {
      const scale = index + 1
      const { controller, placement } = fixtures[index]!
      placement.scale.setScalar(scale)
      const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
      camera.position.set(0, 0.9 * scale, 5 * scale)
      camera.lookAt(0, 0.9 * scale, 0)
      controller.setStageFrame({ camera, root: placement, width: 1200, height: 900, manualControl: false, bounds: new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2)) })
      expect(await controller.play('run-circle')).toBe(true)
    }
    for (let tick = 0; tick < 180; tick++) {
      for (const { controller } of fixtures)
        controller.update(1 / 60)
      expect(fixtures[0]!.root.position.distanceTo(fixtures[1]!.root.position)).toBeLessThan(0.000001)
    }
    for (const { controller } of fixtures)
      controller.dispose()
  })

  it('keeps mirrored travel symmetric under rotated nonuniform placement scales', async () => {
    const fixtures = [createController(), createController()]
    for (let index = 0; index < fixtures.length; index++) {
      const direction = index === 0 ? -1 : 1
      const { controller, placement } = fixtures[index]!
      placement.position.x = direction * 0.3
      placement.rotation.z = direction * 0.3
      placement.scale.set(1.4, 0.7, 1)
      const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
      camera.position.set(0, 0.85, 7)
      camera.lookAt(0, 0.85, 0)
      controller.setStageFrame({ camera, root: placement, width: 1200, height: 900, manualControl: false, bounds: new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2)) })
      expect(await controller.play('run-circle')).toBe(true)
    }
    for (let tick = 0; tick < 180; tick++) {
      for (const { controller } of fixtures)
        controller.update(1 / 60)
      expect(fixtures[0]!.root.position.x).toBeCloseTo(-fixtures[1]!.root.position.x, 8)
      expect(fixtures[0]!.root.position.y).toBeCloseTo(fixtures[1]!.root.position.y, 8)
    }
    for (const { controller } of fixtures)
      controller.dispose()
  })

  it('keeps a walking support foot at ground height through controller clip sanitization', async () => {
    const { controller, vrm, root } = createController()
    const feet = ['leftFoot', 'rightFoot'].map(name => vrm.humanoid.getNormalizedBoneNode(name as 'leftFoot' | 'rightFoot')!)
    root.updateMatrixWorld(true)
    const ground = Math.min(...feet.map(foot => foot.getWorldPosition(new Vector3()).y))
    try {
      expect(await controller.play('walk-circle', { radius: 0 })).toBe(true)
      advance(controller, 0.5)
      for (let frame = 0; frame < 144; frame++) {
        controller.update(1 / 60)
        root.updateMatrixWorld(true)
        const support = Math.min(...feet.map(foot => foot.getWorldPosition(new Vector3()).y))
        expect(Math.abs(support - ground)).toBeLessThan(0.001)
      }
    }
    finally {
      controller.dispose()
    }
  })

  it.each([false, true])('moves walking slower than running at the same playback speed with stage bounds %s', async (stageBound) => {
    const fixtures = [createController(), createController()]
    const distances = [0, 0]
    try {
      for (const [index, { controller, placement }] of fixtures.entries()) {
        if (stageBound) {
          const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
          camera.position.set(0, 0.9, 5)
          camera.lookAt(0, 0.9, 0)
          controller.setStageFrame({ camera, root: placement, width: 1200, height: 900, manualControl: false, bounds: new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2)) })
        }
        expect(await controller.play(index === 0 ? 'walk-circle' : 'run-circle', { duration: 5, speed: 1 })).toBe(true)
      }
      for (let frame = 0; frame < 240; frame++) {
        for (const [index, { controller, root }] of fixtures.entries()) {
          const previous = root.position.clone()
          controller.update(1 / 60)
          distances[index] += root.position.distanceTo(previous)
        }
      }
      expect(distances[0]).toBeGreaterThan(0.5)
      expect(distances[1]).toBeGreaterThan(distances[0] * 1.4)
      expect(fixtures[0]!.controller.snapshot.activeId).toBe('walk-circle')
      expect(fixtures[1]!.controller.snapshot.activeId).toBe('run-circle')
    }
    finally {
      for (const { controller } of fixtures)
        controller.dispose()
    }
  })

  it.each(['blow-kiss', 'laugh', 'head-bob', 'walk-circle', 'shrug', 'attentive-idle', 'thoughtful-idle'])('rejects %s when a close-up lacks body clearance', async (id) => {
    const { controller, root, placement } = createController()
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
    camera.position.set(0, 0.9, 1)
    camera.lookAt(0, 0.9, 0)
    const originalCamera = camera.position.clone()
    const originalRotation = root.quaternion.clone()
    controller.setStageFrame({ camera, root: placement, width: 1200, height: 900, manualControl: false, bounds: new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2)) })
    try {
      expect(await controller.play(id)).toBe(false)
      expect(controller.snapshot.activeId).toBe('default-idle')
      expect(controller.snapshot.queuedIds).toEqual([])
      expect(controller.snapshot.error).toContain('needs more room')
      expect(camera.position.toArray()).toEqual(originalCamera.toArray())
      expect(root.position.toArray()).toEqual([0, 0, 0])
      expect(root.quaternion.toArray()).toEqual(originalRotation.toArray())
      if (id.endsWith('-idle')) {
        expect(await controller.setIdle(id)).toBe(false)
        expect(controller.snapshot.idleId).toBe('default-idle')
      }
    }
    finally {
      controller.dispose()
    }
  })

  it.each(['run-circle', 'walk-circle'])('requires complete stage bounds and moves the avatar through both screen dimensions for %s', async (id) => {
    const { controller, root, placement } = createController()
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
    camera.position.set(0, 0.9, 5)
    camera.lookAt(0, 0.9, 0)
    const frame = { camera, root: placement, width: 1200, height: 900, manualControl: false }
    controller.setStageFrame(frame)
    expect(await controller.play(id)).toBe(false)
    expect(controller.snapshot.error).toContain('preparing model bounds')
    const bounds = new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2))
    controller.setStageFrame({ ...frame, bounds })
    const initialCamera = camera.position.clone()
    expect(await controller.play(id, { duration: 15 })).toBe(true)
    const travel = new Box3()
    for (let tick = 0; tick < 840; tick++) {
      controller.update(1 / 60)
      controller.setStageFrame(frame)
      travel.expandByPoint(root.position)
    }
    expect(travel.getSize(new Vector3()).x).toBeGreaterThan(0.6)
    expect(travel.getSize(new Vector3()).y).toBeGreaterThan(0.3)
    expect(camera.position.toArray()).toEqual(initialCamera.toArray())
    expect(placement.position.toArray()).toEqual([0, 0, 0])
    controller.stop()
    advance(controller, 3)
    expect(root.position.toArray()).toEqual([0, 0, 0])
    controller.dispose()
  })

  it.each(['run-circle', 'walk-circle'])('stops and clears queued motion when a stage resize removes the required space for %s', async (id) => {
    const { controller, root, placement } = createController()
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
    camera.position.set(0, 0.9, 5)
    camera.lookAt(0, 0.9, 0)
    const frame = { camera, root: placement, width: 1200, height: 900, manualControl: false }
    controller.setStageFrame({ ...frame, bounds: new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2)) })
    expect(await controller.play(id)).toBe(true)
    expect(await controller.play('wave', { mode: 'queue' })).toBe(true)
    advance(controller, 1)
    camera.aspect = 160 / 900
    camera.updateProjectionMatrix()
    controller.setStageFrame({ ...frame, width: 160 })
    expect(controller.snapshot.activeId).toBe('default-idle')
    expect(controller.snapshot.queuedIds).toEqual([])
    expect(controller.snapshot.error).toContain('needs more room')
    expect(root.position.toArray()).toEqual([0, 0, 0])
    expect(await controller.play(id)).toBe(false)
    controller.dispose()
  })

  it('rechecks current bounds after asynchronous loading and applies admission to imported idle changes', async () => {
    const { controller, idle, placement } = createController()
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100)
    camera.position.set(0, 0.9, 20)
    camera.lookAt(0, 0.9, 0)
    const frame = { camera, root: placement, width: 1200, height: 900, manualControl: false }
    controller.setStageFrame({ ...frame, bounds: new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2)) })
    let finish: (clip: AnimationClip) => void = () => {}
    controller.catalog.register({ id: 'slow-stage', name: 'Slow stage', category: 'gesture', duration: 4, loop: false, source: 'imported' }, () => new Promise<AnimationClip>((resolve) => {
      finish = resolve
    }))
    const pending = controller.play('slow-stage')
    camera.position.z = 2
    controller.setStageFrame(frame)
    finish(idle.clone())
    expect(await pending).toBe(false)
    expect(controller.snapshot.activeId).toBe('default-idle')
    expect(controller.snapshot.error).toContain('needs more room')
    expect(await controller.setIdle('slow-stage')).toBe(false)
    camera.position.z = 20
    controller.setStageFrame(frame)
    expect(await controller.setIdle('slow-stage')).toBe(true)
    controller.dispose()
  })

  it('keeps stage placement unchanged and returns circle movement smoothly', async () => {
    const { controller, root, placement } = createController()
    placement.position.set(1, 2, 3)
    placement.rotation.set(0.2, 1, 0.3)
    placement.scale.set(2, 2, 2)
    await controller.play('run-circle', { radius: 100 })
    for (let frame = 0; frame < 180; frame++) {
      controller.update(1 / 60)
      expect(root.position.length()).toBeLessThanOrEqual(1.7 * 0.2 + 0.000001)
    }
    const before = root.position.clone()
    expect(before.length()).toBeGreaterThan(0.1)
    controller.stop()
    expect(root.position.toArray()).toEqual(before.toArray())
    controller.update(1 / 60)
    expect(root.position.length()).toBeGreaterThan(0)
    expect(root.position.length()).toBeLessThan(before.length())
    advance(controller, 2)
    expect(root.position.toArray()).toEqual([0, 0, 0])
    expect(root.quaternion.angleTo(new Group().quaternion)).toBeLessThan(0.0001)
    expect(placement.position.toArray()).toEqual([1, 2, 3])
    expect(placement.scale.toArray()).toEqual([2, 2, 2])
    controller.dispose()
  })

  it.each([
    { finish: 'stop', speed: 0.25 },
    { finish: 'stop', speed: 1 },
    { finish: 'stop', speed: 2 },
    { finish: 'timeout', speed: 0.25 },
    { finish: 'timeout', speed: 1 },
    { finish: 'timeout', speed: 2 },
  ])('bounds circle yaw speed and acceleration at rate $speed during entry and $finish return', async ({ finish, speed }) => {
    const { controller, root } = createController()
    const rest = root.quaternion.clone()
    const delta = 1 / 60
    const maximumSpeed = Math.PI
    const maximumAcceleration = Math.PI * 3
    let previousVelocity = 0
    await controller.play('run-circle', { duration: finish === 'timeout' ? 1 : 15, speed })
    for (let frame = 0; frame < 300; frame++) {
      if (finish === 'stop' && frame === 60)
        controller.stop()
      const previous = root.quaternion.clone()
      controller.update(delta)
      const difference = previous.invert().multiply(root.quaternion)
      const rawAngle = 2 * Math.atan2(difference.y, difference.w)
      const angle = Math.atan2(Math.sin(rawAngle), Math.cos(rawAngle))
      const velocity = angle / delta
      expect(Math.abs(angle)).toBeLessThanOrEqual(maximumSpeed * delta + 0.000001)
      expect(Math.abs(velocity - previousVelocity)).toBeLessThanOrEqual(maximumAcceleration * delta + 0.00001)
      previousVelocity = velocity
    }
    expect(controller.snapshot.activeId).toBe('default-idle')
    expect(root.quaternion.toArray()).toEqual(rest.toArray())
    expect(root.position.toArray()).toEqual([0, 0, 0])
    controller.dispose()
  })

  it('resets a detached avatar immediately and cancels its queue', async () => {
    const { controller, root } = createController()
    await controller.play('run-circle')
    await controller.play('bow', { mode: 'queue' })
    advance(controller, 1)
    expect(root.position.length()).toBeGreaterThan(0)
    controller.reset()
    expect(root.position.toArray()).toEqual([0, 0, 0])
    expect(controller.snapshot.activeId).toBe('default-idle')
    expect(controller.snapshot.queuedIds).toEqual([])
    controller.dispose()
  })

  it('advances the clip clock through a slow frame without truncating playback', async () => {
    const { controller } = createController()
    await controller.play('dance', { duration: 15 })
    const initialTime = controller.mixer.time
    controller.update(0.8)
    expect(controller.mixer.time - initialTime).toBeCloseTo(0.8, 10)
    expect(controller.snapshot.activeId).toBe('dance')
    controller.dispose()
  })

  it('counts large frame gaps toward action deadlines and handles invalid deltas', async () => {
    const { controller } = createController()
    await controller.play('dance')
    controller.update(Number.NaN)
    controller.update(-1)
    expect(controller.snapshot.activeId).toBe('dance')
    controller.update(16)
    expect(controller.snapshot.activeId).toBe('default-idle')
    controller.dispose()
  })

  it('filters non-body tracks and anchors hips to the rest pose during another motion', async () => {
    const { controller, vrm, hips } = createController()
    const rest = hips.position.clone()
    await controller.play('bow')
    advance(controller, 1)
    const eye = vrm.humanoid.getNormalizedBoneNode('leftEye')!
    const head = vrm.humanoid.getNormalizedBoneNode('head')!
    const source = new AnimationClip('import', 1, [
      new VectorKeyframeTrack(`${hips.name}.position`, [0, 1], [10, 20, 30, 10.05, 20.02, 30.01]),
      new QuaternionKeyframeTrack(`${head.name}.quaternion`, [0, 1], [0, 0, 0, 1, 0.1, 0, 0, 0.995]),
      new QuaternionKeyframeTrack(`${eye.name}.quaternion`, [0, 1], [0, 0, 0, 1, 0.4, 0, 0, 0.916]),
      new NumberKeyframeTrack('VRMExpression_happy.weight', [0, 1], [0, 1]),
      new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 100, 0, 0]),
      new VectorKeyframeTrack(`${head.name}.scale`, [0, 1], [1, 1, 1, 2, 2, 2]),
    ])
    controller.catalog.register({ id: 'import', name: 'Import', category: 'gesture', duration: 1, loop: false, source: 'imported' }, () => source)
    await controller.play('import')
    advance(controller, 0.5)
    expect(hips.position.x).toBeCloseTo(rest.x + 0.05 * 31 / 60, 2)
    expect(hips.position.y).toBeCloseTo(rest.y + 0.02 * 31 / 60, 2)
    expect(eye.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(vrm.scene.position.toArray()).toEqual([0, 0, 0])
    expect(head.scale.toArray()).toEqual([1, 1, 1])
    expect(Array.from(source.tracks[0].values).slice(0, 3)).toEqual([10, 20, 30])
    controller.dispose()
  })

  it('rejects clips without body tracks and bounds imported root drift', async () => {
    const { controller, hips } = createController()
    const empty = new AnimationClip('expressions', 1, [new NumberKeyframeTrack('happy.weight', [0, 1], [0, 1])])
    controller.catalog.register({ id: 'empty', name: 'Empty', category: 'gesture', duration: 1, loop: false, source: 'imported' }, () => empty)
    expect(await controller.play('empty')).toBe(false)
    expect(controller.snapshot.activeId).toBe('default-idle')
    const drift = new AnimationClip('drift', 1, [new VectorKeyframeTrack(`${hips.name}.position`, [0, 1], [0, 0, 0, 1000, 1000, 1000])])
    controller.catalog.register({ id: 'drift', name: 'Drift', category: 'gesture', duration: 1, loop: false, source: 'imported' }, () => drift)
    expect(await controller.play('drift')).toBe(true)
    advance(controller, 0.9)
    expect(Math.hypot(hips.position.x, hips.position.z)).toBeLessThanOrEqual(1.7 * 0.2)
    expect(hips.position.y).toBeLessThanOrEqual(0.9 + 1.7 * 0.25)
    controller.dispose()
  })
})

describe('procedural motions', () => {
  it('retargets full-body tracks for all built-ins without gaze or expression tracks', async () => {
    const { vrm } = createRig()
    const catalog = createMotionCatalog()
    const forbidden = ['leftEye', 'rightEye', 'jaw'].map(name => vrm.humanoid.getNormalizedBoneNode(name as 'leftEye' | 'rightEye' | 'jaw')!.uuid)
    for (const metadata of builtinMotionMetadata) {
      const clip = await catalog.load(metadata.id, vrm, new AbortController().signal)
      expect(clip.duration).toBe(metadata.duration)
      expect(clip.tracks.length).toBeGreaterThan(15)
      expect(clip.tracks.every(track => !forbidden.some(id => track.name.startsWith(id)))).toBe(true)
      expect(clip.tracks.every(track => track.values.every(Number.isFinite))).toBe(true)
      expect(clip.tracks.every(track => track.times[0] === 0)).toBe(true)
    }
  })

  it.each(['bow', 'dance', 'natural-idle'])('keeps both feet planted throughout %s on different body scales', async (id) => {
    for (const scale of [0.6, 1, 1.8]) {
      const { vrm, root } = createRig(scale)
      const feet = ['leftFoot', 'rightFoot'].map(name => vrm.humanoid.getNormalizedBoneNode(name as 'leftFoot' | 'rightFoot')!)
      root.updateMatrixWorld(true)
      const rest = feet.map(foot => foot.getWorldPosition(new Vector3()))
      const clip = await createMotionCatalog().load(id, vrm, new AbortController().signal)
      const mixer = new AnimationMixer(vrm.scene)
      mixer.clipAction(clip).play()
      for (let frame = 0; frame < clip.duration * 60; frame++) {
        mixer.update(1 / 60)
        root.updateMatrixWorld(true)
        for (let index = 0; index < feet.length; index++)
          expect(feet[index].getWorldPosition(new Vector3()).distanceTo(rest[index])).toBeLessThan(0.001 * scale)
      }
      mixer.stopAllAction()
      mixer.uncacheRoot(vrm.scene)
    }
  })

  it('keeps feet planted when the rest legs have depth and lateral offsets', async () => {
    const { vrm, root } = createRig(1, true)
    const foot = vrm.humanoid.getNormalizedBoneNode('leftFoot')!
    root.updateMatrixWorld(true)
    const rest = foot.getWorldPosition(new Vector3())
    const clip = await createMotionCatalog().load('bow', vrm, new AbortController().signal)
    const mixer = new AnimationMixer(vrm.scene)
    mixer.clipAction(clip).play()
    for (let frame = 0; frame < clip.duration * 60; frame++) {
      mixer.update(1 / 60)
      root.updateMatrixWorld(true)
      expect(foot.getWorldPosition(new Vector3()).distanceTo(rest)).toBeLessThan(0.001)
    }
    mixer.stopAllAction()
  })

  it('produces opposite running strides with full knee, foot, and arm movement', async () => {
    const { vrm } = createRig()
    const clip = await createMotionCatalog().load('run-circle', vrm, new AbortController().signal)
    const mixer = new AnimationMixer(vrm.scene)
    mixer.clipAction(clip).play()
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg')!
    const right = vrm.humanoid.getNormalizedBoneNode('rightUpperLeg')!
    mixer.update(clip.duration / 4)
    expect(left.rotation.x).toBeLessThan(-0.27)
    expect(right.rotation.x).toBeGreaterThan(0.27)
    expect(vrm.humanoid.getNormalizedBoneNode('rightLowerLeg')!.rotation.x).toBeGreaterThan(1.2)
    expect(vrm.humanoid.getNormalizedBoneNode('rightFoot')!.rotation.x).toBeLessThan(-0.4)
    expect(vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!.rotation.x).toBeGreaterThan(0.6)
    expect(vrm.humanoid.getNormalizedBoneNode('rightUpperArm')!.rotation.x).toBeLessThan(-0.6)
    mixer.update(clip.duration / 2)
    expect(left.rotation.x).toBeGreaterThan(0.27)
    expect(right.rotation.x).toBeLessThan(-0.27)
    mixer.stopAllAction()
  })

  it('bounds the running stride and visible hips bob at different avatar scales', async () => {
    for (const scale of [0.6, 1, 1.8]) {
      const { vrm, hips } = createRig(scale)
      const height = 1.7 * scale
      const restY = hips.position.y
      const left = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg')!
      const right = vrm.humanoid.getNormalizedBoneNode('rightUpperLeg')!
      const clip = await createMotionCatalog().load('run-circle', vrm, new AbortController().signal)
      const mixer = new AnimationMixer(vrm.scene)
      mixer.clipAction(clip).play()
      let stride = 0
      let bob = 0
      for (let frame = 0; frame < clip.duration * 120; frame++) {
        mixer.update(1 / 120)
        stride = Math.max(stride, Math.abs(left.rotation.x), Math.abs(right.rotation.x))
        bob = Math.max(bob, restY - hips.position.y)
        expect(Math.abs(left.rotation.x)).toBeLessThanOrEqual(0.520001)
        expect(Math.abs(right.rotation.x)).toBeLessThanOrEqual(0.520001)
        expect(restY - hips.position.y).toBeLessThanOrEqual(height * 0.024 + 0.000001)
        expect(hips.position.y - restY).toBeLessThanOrEqual(0.000001)
      }
      expect(stride).toBeGreaterThan(0.27)
      expect(bob).toBeGreaterThan(height * 0.022)
      mixer.stopAllAction()
      mixer.uncacheRoot(vrm.scene)
    }
  })

  it('raises the waving hand above its shoulder', async () => {
    const { vrm, root } = createRig()
    const clip = await createMotionCatalog().load('wave', vrm, new AbortController().signal)
    const mixer = new AnimationMixer(vrm.scene)
    mixer.clipAction(clip).play()
    mixer.update(clip.duration * 0.5)
    root.updateMatrixWorld(true)
    const hand = vrm.humanoid.getNormalizedBoneNode('rightHand')!.getWorldPosition(new Vector3())
    const shoulder = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')!.getWorldPosition(new Vector3())
    expect(hand.y).toBeGreaterThan(shoulder.y + 0.15)
    mixer.stopAllAction()
  })

  it('uses each avatar\'s rest geometry while another pose is active', async () => {
    const { controller, vrm } = createController()
    const catalog = createMotionCatalog()
    const before = await catalog.load('dance', vrm, new AbortController().signal)
    await controller.play('bow')
    advance(controller, 1)
    const during = await catalog.load('dance', vrm, new AbortController().signal)
    for (let index = 0; index < before.tracks.length; index++)
      expect(Array.from(during.tracks[index].values)).toEqual(Array.from(before.tracks[index].values))
    controller.dispose()
  })
})
