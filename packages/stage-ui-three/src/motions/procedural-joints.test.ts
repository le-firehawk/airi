import type { VRMCore, VRMHumanBoneName, VRMHumanBones } from '@pixiv/three-vrm-core'

import { readFile } from 'node:fs/promises'

import { VRM, VRMNodeConstraintManager, VRMRotationConstraint } from '@pixiv/three-vrm'
import { VRMHumanoid } from '@pixiv/three-vrm-core'
import { AnimationMixer, Euler, Group, Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { builtinMotionMetadata, createMotionCatalog, loadMotionClip, loadRelaxedIdleClip, MotionController } from './index'
import { JointKinematics } from './joint-kinematics'

const nearHeadMotions = new Set(['blow-kiss', 'thoughtful-idle'])

interface JointRigOptions {
  facing?: number
  armRest?: number
  forearmRest?: number
  shoulders?: boolean
  rawRotations?: boolean
  scale?: number
  tilt?: number
  carrying?: boolean
  version?: '0' | '1'
}

function createJointRig({ facing = 0, armRest = 0, forearmRest = armRest, shoulders = true, rawRotations = false, scale = 1, tilt = 0, carrying = false, version = '1' }: JointRigOptions = {}) {
  const scene = new Group()
  const bones: Partial<VRMHumanBones> = {}
  const frame = new Quaternion().setFromEuler(new Euler(tilt, facing, -tilt * 0.5, 'YXZ'))
  function bone(name: VRMHumanBoneName, parent: VRMHumanBoneName | undefined, position: Vector3) {
    const node = new Object3D()
    node.name = name
    const parentNode = parent ? bones[parent]!.node : scene
    parentNode.add(node)
    scene.updateMatrixWorld(true)
    node.position.copy(parentNode.worldToLocal(position.multiplyScalar(scale).applyQuaternion(frame)))
    if (rawRotations)
      node.quaternion.setFromEuler(new Euler(0.17, -0.23, 0.31))
    scene.updateMatrixWorld(true)
    bones[name] = { node }
  }
  bone('hips', undefined, new Vector3(0, 0.95, 0))
  bone('spine', 'hips', new Vector3(0, 1.15, 0))
  bone('chest', 'spine', new Vector3(0, 1.4, 0))
  bone('neck', 'chest', new Vector3(0, 1.55, 0))
  bone('head', 'neck', new Vector3(0, 1.68, 0))
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1
    bone(`${side}UpperLeg`, 'hips', new Vector3(sign * 0.09, 0.95, 0))
    bone(`${side}LowerLeg`, `${side}UpperLeg`, new Vector3(sign * 0.09, 0.5, 0))
    bone(`${side}Foot`, `${side}LowerLeg`, new Vector3(sign * 0.09, 0.1, 0))
    if (shoulders)
      bone(`${side}Shoulder`, 'chest', new Vector3(sign * 0.06, 1.48, 0))
    const upper = new Vector3(sign * 0.2, 1.48, 0)
    bone(`${side}UpperArm`, shoulders ? `${side}Shoulder` : 'chest', upper.clone())
    const direction = new Vector3(sign * Math.cos(armRest), -Math.sin(armRest), 0)
    bone(`${side}LowerArm`, `${side}UpperArm`, upper.clone().addScaledVector(direction, 0.25))
    const forearm = new Vector3(sign * Math.cos(forearmRest), -Math.sin(forearmRest), 0)
    const hand = upper.clone().addScaledVector(direction, 0.25).addScaledVector(forearm, 0.22)
    bone(`${side}Hand`, `${side}LowerArm`, hand.clone())
    bone(`${side}IndexProximal`, `${side}Hand`, hand.clone().addScaledVector(forearm, 0.04))
    bone(`${side}IndexIntermediate`, `${side}IndexProximal`, hand.clone().addScaledVector(forearm, 0.06))
    bone(`${side}IndexDistal`, `${side}IndexIntermediate`, hand.clone().addScaledVector(forearm, 0.075))
  }
  const nodeConstraintManager = new VRMNodeConstraintManager()
  if (carrying) {
    for (const side of ['left', 'right'] as const) {
      const upper = bones[`${side}UpperArm`]!.node
      const lower = bones[`${side}LowerArm`]!.node
      const helper = new Object3D()
      helper.position.copy(lower.position)
      upper.add(helper)
      scene.updateMatrixWorld(true)
      helper.attach(lower)
      const constraint = new VRMRotationConstraint(helper, upper)
      constraint.weight = side === 'left' ? 0.131346 : 0.107642
      nodeConstraintManager.addConstraint(constraint)
    }
    nodeConstraintManager.setInitState()
  }
  const humanoid = new VRMHumanoid(bones as VRMHumanBones)
  scene.add(humanoid.normalizedHumanBonesRoot)
  const vrm = new VRM({ scene, humanoid, nodeConstraintManager, meta: version === '0' ? { metaVersion: '0', title: 'Joint fixture', author: 'AIRI' } : { metaVersion: '1', name: 'Joint fixture', authors: ['AIRI'], licenseUrl: 'https://opensource.org/license/mit' } })
  const root = new Group()
  root.add(scene)
  return { vrm, root, frame }
}

function position(vrm: VRMCore, name: VRMHumanBoneName) {
  return vrm.humanoid.getNormalizedBoneNode(name)!.getWorldPosition(new Vector3())
}

function expectRelaxed(vrm: VRMCore, frame: Quaternion) {
  for (const side of ['left', 'right'] as const) {
    const arm = position(vrm, `${side}UpperArm`)
    const hand = position(vrm, `${side}Hand`)
    const offset = hand.sub(arm).applyQuaternion(frame.clone().invert())
    expect(offset.y).toBeLessThan(-0.43)
    expect(Math.abs(offset.x)).toBeLessThan(0.075)
    expect(offset.z).toBeGreaterThan(-0.01)
  }
}

describe('procedural joint geometry', () => {
  it.each([
    { facing: 0, armRest: 0, shoulders: true, rawRotations: false },
    { facing: Math.PI, armRest: 0, shoulders: true, rawRotations: false, version: '0' as const },
    { facing: 0, armRest: 0.45, shoulders: true, rawRotations: true },
    { facing: Math.PI, armRest: 0.45, shoulders: false, rawRotations: true, version: '0' as const },
    { facing: 0.7, armRest: 0.35, forearmRest: 0.55, shoulders: true, rawRotations: true, tilt: 0.2 },
  ])('lowers idle arms from the source rest geometry: %j', async (options) => {
    const { vrm, root, frame } = createJointRig(options)
    const clip = await createMotionCatalog().load('natural-idle', vrm, new AbortController().signal)
    const mixer = new AnimationMixer(vrm.scene)
    mixer.clipAction(clip).play()
    for (let sample = 0; sample < 120; sample++) {
      mixer.update(clip.duration / 120)
      vrm.humanoid.update()
      root.updateMatrixWorld(true)
      expectRelaxed(vrm, frame)
      for (const side of ['left', 'right'] as const) {
        const raw = vrm.humanoid.getRawBoneNode(`${side}Hand`)!.getWorldPosition(new Vector3())
        expect(raw.distanceTo(position(vrm, `${side}Hand`))).toBeLessThan(0.00001)
      }
    }
    mixer.stopAllAction()
  })

  it.each(['celebrate', 'stretch', 'wave'])('shares %s elevation with the clavicle and keeps a single elbow hinge', async (id) => {
    const { vrm, root } = createJointRig()
    const clip = await createMotionCatalog().load(id, vrm, new AbortController().signal)
    const mixer = new AnimationMixer(vrm.scene)
    mixer.clipAction(clip).play()
    mixer.update(clip.duration * 0.5)
    root.updateMatrixWorld(true)
    const shoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder')!
    const elbow = vrm.humanoid.getNormalizedBoneNode('rightLowerArm')!
    expect(Math.abs(shoulder.rotation.z)).toBeGreaterThan(0.08)
    expect(Math.abs(elbow.quaternion.x)).toBeLessThan(0.000001)
    expect(Math.abs(elbow.quaternion.z)).toBeLessThan(0.000001)
    expect(position(vrm, 'rightHand').y).toBeGreaterThan(position(vrm, 'rightUpperArm').y + 0.15)
    mixer.stopAllAction()
  })

  it('returns to geometry-correct idle after interrupted gestures and stop', async () => {
    const { vrm, root, frame } = createJointRig({ facing: Math.PI, armRest: 0.35, rawRotations: true })
    const idle = await createMotionCatalog().load('natural-idle', vrm, new AbortController().signal)
    const controller = new MotionController(vrm, idle, root)
    await controller.setIdle('natural-idle')
    await controller.play('celebrate')
    controller.update(0.12)
    await controller.play('wave')
    controller.update(0.08)
    controller.stop()
    controller.update(0.08)
    controller.stop()
    for (let sample = 0; sample < 120; sample++)
      controller.update(1 / 60)
    root.updateMatrixWorld(true)
    expectRelaxed(vrm, frame)
    expect(controller.snapshot.activeId).toBe('natural-idle')
    controller.dispose()
  })

  it.each([0, Math.PI])('keeps elbows and knees inside their bend limits for facing %s', async (facing) => {
    const { vrm, root, frame } = createJointRig({ facing, armRest: 0.35, forearmRest: 0.5, rawRotations: true })
    const catalog = createMotionCatalog()
    const lateral = new Vector3(1, 0, 0).applyQuaternion(frame)
    for (const metadata of builtinMotionMetadata) {
      const clip = await catalog.load(metadata.id, vrm, new AbortController().signal)
      const mixer = new AnimationMixer(vrm.scene)
      mixer.clipAction(clip).play()
      for (let sample = 0; sample < 120; sample++) {
        mixer.update(clip.duration / 120)
        vrm.humanoid.update()
        root.updateMatrixWorld(true)
        for (const side of ['left', 'right'] as const) {
          const upper = position(vrm, `${side}LowerArm`).sub(position(vrm, `${side}UpperArm`))
          const lower = position(vrm, `${side}Hand`).sub(position(vrm, `${side}LowerArm`))
          const thigh = position(vrm, `${side}LowerLeg`).sub(position(vrm, `${side}UpperLeg`))
          const shin = position(vrm, `${side}Foot`).sub(position(vrm, `${side}LowerLeg`))
          expect(upper.angleTo(lower)).toBeGreaterThan(0.035)
          const maximumFlexion = side === 'right' && nearHeadMotions.has(metadata.id) ? 2.35001 : 2.21
          expect(upper.angleTo(lower), `${metadata.id} ${side} normalized elbow`).toBeLessThan(maximumFlexion)
          expect(thigh.angleTo(shin)).toBeLessThan(2.4)
          expect(new Vector3().crossVectors(thigh, shin).dot(lateral)).toBeGreaterThan(-0.00001)
          expect(upper.length()).toBeCloseTo(0.25, 5)
          expect(lower.length()).toBeCloseTo(0.22, 5)
        }
      }
      mixer.stopAllAction()
      mixer.uncacheRoot(vrm.scene)
    }
  })

  it('keeps clip geometry independent of playback and stage placement', async () => {
    const { vrm, root } = createJointRig({ facing: Math.PI, armRest: 0.4 })
    const catalog = createMotionCatalog()
    const before = await catalog.load('stretch', vrm, new AbortController().signal)
    root.rotation.set(0.25, 0.6, -0.15)
    root.position.set(2, 3, -4)
    root.scale.setScalar(1.8)
    vrm.humanoid.getNormalizedBoneNode('leftUpperArm')!.rotation.set(0.3, 0.4, 0.5)
    root.updateMatrixWorld(true)
    const after = await catalog.load('stretch', vrm, new AbortController().signal)
    for (let index = 0; index < before.tracks.length; index++)
      expect(Array.from(after.tracks[index].values)).toEqual(Array.from(before.tracks[index].values))
  })

  it('keeps malformed zero-length rest segments finite without optional clavicles', async () => {
    const { vrm } = createJointRig({ scale: 0, shoulders: false })
    for (const metadata of builtinMotionMetadata) {
      const clip = await createMotionCatalog().load(metadata.id, vrm, new AbortController().signal)
      for (const track of clip.tracks)
        expect(Array.from(track.values).every(Number.isFinite)).toBe(true)
    }
  })

  it('retargets the 48-second Relaxed arms idle without changing its body tracks or the imported source', async () => {
    const file = await readFile(new URL('../../../stage-ui/src/features/motions/vrm/relaxed-idle.vrma', import.meta.url))
    const bytes = new Uint8Array(file).buffer
    const { vrm, root, frame } = createJointRig({ facing: Math.PI, armRest: 0.4, rawRotations: true, version: '0' })
    const signal = new AbortController().signal
    const original = await loadMotionClip(bytes, vrm, signal)
    const sourceValues = original.tracks.map(track => Array.from(track.values))
    const relaxed = await loadRelaxedIdleClip(bytes, vrm, signal)
    expect(relaxed.duration).toBe(48)
    expect(relaxed.blendMode).toBe(original.blendMode)
    const replacedTargets = new Set<string>()
    for (const side of ['left', 'right'] as const) {
      for (const part of ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const) {
        const bone = vrm.humanoid.getNormalizedBoneNode(`${side}${part}`)!
        replacedTargets.add(`${bone.name}.quaternion`)
        replacedTargets.add(`${bone.uuid}.quaternion`)
      }
    }
    const retained = original.tracks.filter(track => !replacedTargets.has(track.name))
    expect(retained.some(track => track.name.includes('IndexProximal'))).toBe(true)
    for (const track of retained) {
      const copy = relaxed.tracks.find(candidate => candidate.name === track.name)!
      expect(copy.times).toEqual(track.times)
      expect(copy.values).toEqual(track.values)
      expect(copy.getInterpolation()).toBe(track.getInterpolation())
    }
    const mixer = new AnimationMixer(vrm.scene)
    mixer.clipAction(relaxed).play()
    for (let sample = 0; sample < 192; sample++) {
      mixer.update(0.25)
      root.updateMatrixWorld(true)
      expectRelaxed(vrm, frame)
    }
    expect(original.tracks.map(track => Array.from(track.values))).toEqual(sourceValues)
    mixer.stopAllAction()
  })

  it('retains authored forearm constraints and bounded raw joints after the full VRM update', async () => {
    const { vrm, root } = createJointRig({ armRest: 0.04, rawRotations: true, carrying: true })
    const constraints = [...vrm.nodeConstraintManager!.constraints]
    const bindings = constraints.map(({ source, destination, weight }) => ({ source, destination, weight }))
    const rawRest = structuredClone(vrm.humanoid.rawRestPose)
    const catalog = createMotionCatalog()
    for (const metadata of builtinMotionMetadata) {
      const clip = await catalog.load(metadata.id, vrm, new AbortController().signal)
      const mixer = new AnimationMixer(vrm.scene)
      mixer.clipAction(clip).play()
      for (let sample = 0; sample < 60; sample++) {
        mixer.update(clip.duration / 60)
        vrm.update(0)
        root.updateMatrixWorld(true)
        for (const side of ['left', 'right'] as const) {
          const upper = vrm.humanoid.getRawBoneNode(`${side}UpperArm`)!.getWorldPosition(new Vector3())
          const lower = vrm.humanoid.getRawBoneNode(`${side}LowerArm`)!.getWorldPosition(new Vector3())
          const hand = vrm.humanoid.getRawBoneNode(`${side}Hand`)!.getWorldPosition(new Vector3())
          const upperDirection = lower.clone().sub(upper)
          const lowerDirection = hand.sub(lower)
          const maximumFlexion = side === 'right' && nearHeadMotions.has(metadata.id) ? 2.55 : 2.21
          expect(upperDirection.angleTo(lowerDirection), `${metadata.id} ${side} raw elbow`).toBeLessThan(maximumFlexion)
          expect(upperDirection.length()).toBeCloseTo(0.25, 5)
          expect(lowerDirection.length()).toBeCloseTo(0.22, 5)
        }
      }
      mixer.stopAllAction()
      mixer.uncacheRoot(vrm.scene)
    }
    expect([...vrm.nodeConstraintManager!.constraints]).toEqual(constraints)
    expect(constraints.map(({ source, destination, weight }) => ({ source, destination, weight }))).toEqual(bindings)
    expect(vrm.humanoid.rawRestPose).toEqual(rawRest)
  })

  it.each(['bow', 'dance', 'natural-idle'])('plants both feet in %s across facing directions and source scales', async (id) => {
    for (const facing of [0, Math.PI]) {
      for (const scale of [0.6, 1.8]) {
        const { vrm, root } = createJointRig({ facing, scale, tilt: 0.15, rawRotations: true })
        root.updateMatrixWorld(true)
        const rest = [position(vrm, 'leftFoot'), position(vrm, 'rightFoot')]
        const clip = await createMotionCatalog().load(id, vrm, new AbortController().signal)
        const mixer = new AnimationMixer(vrm.scene)
        mixer.clipAction(clip).play()
        for (let sample = 0; sample < 120; sample++) {
          mixer.update(clip.duration / 120)
          vrm.update(0)
          root.updateMatrixWorld(true)
          expect(position(vrm, 'leftFoot').distanceTo(rest[0])).toBeLessThan(0.001 * scale)
          expect(position(vrm, 'rightFoot').distanceTo(rest[1])).toBeLessThan(0.001 * scale)
        }
        mixer.stopAllAction()
        mixer.uncacheRoot(vrm.scene)
      }
    }
  })

  it.each([0, Math.PI])('reaches near the head with fixed bone lengths and rest measurements for facing %s', (facing) => {
    const { vrm, root, frame } = createJointRig({ facing, armRest: 0.35, forearmRest: 0.5, rawRotations: true })
    const joints = new JointKinematics(vrm)
    const target = joints.restPoint('head')!.add(new Vector3(-0.05, 0, 0.18))
    const rest = joints.restPoint('rightUpperArm')!
    for (const [name, rotation] of joints.reachArm('right', target))
      vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.copy(rotation)
    vrm.update(0)
    root.updateMatrixWorld(true)
    const hand = position(vrm, 'rightHand').applyQuaternion(frame.clone().invert())
    expect(hand.distanceTo(target)).toBeLessThan(0.00001)
    expect(position(vrm, 'rightLowerArm').distanceTo(position(vrm, 'rightUpperArm'))).toBeCloseTo(0.25, 5)
    expect(position(vrm, 'rightHand').distanceTo(position(vrm, 'rightLowerArm'))).toBeCloseTo(0.22, 5)
    root.rotation.set(0.2, 0.4, -0.1)
    root.scale.setScalar(2)
    root.updateMatrixWorld(true)
    expect(new JointKinematics(vrm).restPoint('rightUpperArm')!.toArray()).toEqual(rest.toArray())
  })

  it('clamps unreachable hand targets instead of extending the arm or overbending the elbow', () => {
    const { vrm, root } = createJointRig({ armRest: 0.35, forearmRest: 0.5 })
    const joints = new JointKinematics(vrm)
    const target = joints.restPoint('rightUpperArm')!
    for (const [name, rotation] of joints.reachArm('right', target))
      vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.copy(rotation)
    vrm.update(0)
    root.updateMatrixWorld(true)
    const upper = position(vrm, 'rightLowerArm').sub(position(vrm, 'rightUpperArm'))
    const lower = position(vrm, 'rightHand').sub(position(vrm, 'rightLowerArm'))
    expect(upper.length()).toBeCloseTo(0.25, 5)
    expect(lower.length()).toBeCloseTo(0.22, 5)
    expect(upper.angleTo(lower)).toBeCloseTo(2, 5)
    expect(position(vrm, 'rightHand').distanceTo(target)).toBeGreaterThan(0.2)
  })

  it('caps an explicitly expanded reach without changing the default reach limit', () => {
    for (const [requested, expected] of [[undefined, 2], [2.35, 2.35], [100, 2.35]] as const) {
      const { vrm, root } = createJointRig({ armRest: 0.35, forearmRest: 0.5 })
      const joints = new JointKinematics(vrm)
      const target = joints.restPoint('rightUpperArm')!
      for (const [name, rotation] of joints.reachArm('right', target, requested))
        vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.copy(rotation)
      root.updateMatrixWorld(true)
      const upper = position(vrm, 'rightLowerArm').sub(position(vrm, 'rightUpperArm'))
      const lower = position(vrm, 'rightHand').sub(position(vrm, 'rightLowerArm'))
      expect(upper.angleTo(lower)).toBeCloseTo(expected, 5)
      expect(upper.length()).toBeCloseTo(0.25, 5)
      expect(lower.length()).toBeCloseTo(0.22, 5)
    }
  })

  it.each([0, Math.PI])('preserves bounded wrist articulation without moving the reached hand for facing %s', (facing) => {
    const { vrm, root } = createJointRig({ facing, armRest: 0.35, forearmRest: 0.5, rawRotations: true })
    const joints = new JointKinematics(vrm)
    const target = joints.restPoint('head')!.add(new Vector3(-0.05, 0, 0.18))
    const neutral = joints.reachArm('right', target, 2.35)
    for (const [name, rotation] of neutral)
      vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.copy(rotation)
    root.updateMatrixWorld(true)
    const hand = position(vrm, 'rightHand')
    for (const [requested, expected] of [[-0.2, 0.2], [-100, 0.45], [100, 0.45]]) {
      const articulated = joints.reachArm('right', target, 2.35, requested)
      for (const [name, rotation] of articulated) {
        expect(rotation.angleTo(neutral.get(name)!)).toBeCloseTo(name === 'rightHand' ? expected : 0, 5)
        vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.copy(rotation)
      }
      root.updateMatrixWorld(true)
      expect(position(vrm, 'rightHand').distanceTo(hand)).toBeLessThan(0.00001)
    }
  })

  it.each([0, Math.PI])('keeps near-head transitions and holds bounded without reversing the elbow pole for facing %s', async (facing) => {
    for (const id of nearHeadMotions) {
      const { vrm, root, frame } = createJointRig({ facing, armRest: 0.04, rawRotations: true, carrying: true })
      const catalog = createMotionCatalog()
      const metadata = catalog.get(id)!
      const idle = await catalog.load('natural-idle', vrm, new AbortController().signal)
      const controller = new MotionController(vrm, idle, root, catalog)
      const inverseFrame = frame.clone().invert()
      const constraints = [...vrm.nodeConstraintManager!.constraints]
      const bindings = constraints.map(({ source, destination, weight }) => ({ source, destination, weight }))
      const rawRest = structuredClone(vrm.humanoid.rawRestPose)
      try {
        expect(await controller.play(id, { duration: metadata.duration })).toBe(true)
        for (let tick = 0; tick < Math.ceil((metadata.duration + 1) * 60); tick++) {
          controller.update(1 / 60)
          vrm.update(1 / 60)
          root.updateMatrixWorld(true)
          for (const kind of ['raw', 'normalized'] as const) {
            const node = (bone: VRMHumanBoneName) => (kind === 'raw' ? vrm.humanoid.getRawBoneNode(bone)! : vrm.humanoid.getNormalizedBoneNode(bone)!)
            const shoulder = node('rightUpperArm').getWorldPosition(new Vector3()).applyQuaternion(inverseFrame)
            const elbow = node('rightLowerArm').getWorldPosition(new Vector3()).applyQuaternion(inverseFrame)
            const hand = node('rightHand').getWorldPosition(new Vector3()).applyQuaternion(inverseFrame)
            const upper = elbow.clone().sub(shoulder)
            const lower = hand.clone().sub(elbow)
            const limit = kind === 'raw' ? 2.55 : 2.35001
            expect(upper.angleTo(lower), `${id} ${kind} frame ${tick}`).toBeLessThan(limit)
            expect(upper.length()).toBeCloseTo(0.25, 5)
            expect(lower.length()).toBeCloseTo(0.22, 5)
            const reach = hand.clone().sub(shoulder).normalize()
            const pole = new Vector3(-0.8, -1, 0)
            pole.addScaledVector(reach, -pole.dot(reach)).normalize()
            const elbowOffset = upper.clone().addScaledVector(reach, -upper.dot(reach))
            expect(elbowOffset.dot(pole), `${id} ${kind} reversed pole at frame ${tick}`).toBeGreaterThanOrEqual(-0.00001)
          }
        }
        expect(controller.snapshot.activeId).toBe('default-idle')
        expect([...vrm.nodeConstraintManager!.constraints]).toEqual(constraints)
        expect(constraints.map(({ source, destination, weight }) => ({ source, destination, weight }))).toEqual(bindings)
        expect(vrm.humanoid.rawRestPose).toEqual(rawRest)
      }
      finally {
        controller.dispose()
      }
    }
  })

  it('keeps built-in loops periodic and adjacent quaternion samples smooth', async () => {
    const { vrm } = createJointRig({ armRest: 0.3 })
    for (const metadata of builtinMotionMetadata) {
      const clip = await createMotionCatalog().load(metadata.id, vrm, new AbortController().signal)
      for (const track of clip.tracks) {
        const size = track.getValueSize()
        const first = Array.from(track.values.slice(0, size))
        const last = Array.from(track.values.slice(-size))
        if (metadata.loop) {
          for (let axis = 0; axis < size; axis++)
            expect(last[axis], `${metadata.id} ${track.name} loop seam`).toBeCloseTo(first[axis], 5)
        }
        if (size === 4) {
          for (let offset = 4; offset < track.values.length; offset += 4) {
            const previous = new Quaternion().fromArray(track.values, offset - 4)
            const next = new Quaternion().fromArray(track.values, offset)
            expect(previous.angleTo(next), `${metadata.id} ${track.name} phase ${offset / 4}`).toBeLessThan(0.5)
          }
        }
      }
    }
  })

  it('gives the walking gait alternating grounded support and raised swing feet', async () => {
    for (const scale of [0.6, 1.8]) {
      const { vrm, root } = createJointRig({ scale })
      root.updateMatrixWorld(true)
      const restHeight = position(vrm, 'leftFoot').y
      const clip = await createMotionCatalog().load('walk-circle', vrm, new AbortController().signal)
      const mixer = new AnimationMixer(vrm.scene)
      mixer.clipAction(clip).play()
      const raised: Record<string, number> = { left: 0, right: 0 }
      for (let sample = 0; sample < 120; sample++) {
        mixer.setTime(sample / 120 * clip.duration)
        vrm.update(0)
        root.updateMatrixWorld(true)
        const left = position(vrm, 'leftFoot')
        const right = position(vrm, 'rightFoot')
        raised.left = Math.max(raised.left, left.y - restHeight)
        raised.right = Math.max(raised.right, right.y - restHeight)
        expect(Math.min(left.y, right.y)).toBeCloseTo(restHeight, 3)
        expect(left.y).toBeGreaterThan(restHeight - 0.0005 * scale)
        expect(right.y).toBeGreaterThan(restHeight - 0.0005 * scale)
        expect(Math.abs(left.z)).toBeLessThan(0.15 * scale)
        expect(Math.abs(right.z)).toBeLessThan(0.15 * scale)
      }
      expect(raised.left).toBeGreaterThan(0.025 * scale)
      expect(raised.right).toBeGreaterThan(0.025 * scale)
      mixer.stopAllAction()
    }
  })

  it('separates the kiss contact and release phases from the thoughtful pose', async () => {
    const { vrm, root } = createJointRig()
    const catalog = createMotionCatalog()
    const kiss = await catalog.load('blow-kiss', vrm, new AbortController().signal)
    const mixer = new AnimationMixer(vrm.scene)
    mixer.clipAction(kiss).play()
    mixer.setTime(kiss.duration * 0.35)
    root.updateMatrixWorld(true)
    const contact = position(vrm, 'rightHand')
    mixer.setTime(kiss.duration * 0.7)
    root.updateMatrixWorld(true)
    const release = position(vrm, 'rightHand')
    expect(release.z).toBeGreaterThan(contact.z + 0.1)
    expect(release.x).toBeLessThan(contact.x - 0.1)
    mixer.stopAllAction()
    const thoughtful = await catalog.load('thoughtful-idle', vrm, new AbortController().signal)
    mixer.clipAction(thoughtful).play()
    mixer.setTime(thoughtful.duration * 0.5)
    root.updateMatrixWorld(true)
    expect(position(vrm, 'rightHand').y).toBeLessThan(contact.y)
    mixer.stopAllAction()
  })
})
