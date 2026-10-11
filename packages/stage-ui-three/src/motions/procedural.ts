import type { VRMCore, VRMHumanBoneName } from '@pixiv/three-vrm-core'

import type { ArmPose } from './joint-kinematics'

import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'

import { JointKinematics } from './joint-kinematics'
import { measureRig } from './rig'
import { createRunGaitPose } from './run-gait'

type Angles = [number, number, number]
type Pose = Partial<Record<VRMHumanBoneName, Angles>>

function smooth(value: number) {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}

function envelope(progress: number) {
  return smooth(progress / 0.22) * smooth((1 - progress) / 0.24)
}

function plantLeg(pose: Pose, side: 'left' | 'right', thighRest: Vector3, shinRest: Vector3, hipDrop: number, hipDepth: number) {
  // The sagittal two-link solution preserves the ankle point and each bone's lateral rest offset.
  const thigh = Math.max(0.01, Math.hypot(thighRest.y, thighRest.z))
  const shin = Math.max(0.01, Math.hypot(shinRest.y, shinRest.z))
  const vertical = -thighRest.y - shinRest.y - hipDrop
  const depth = thighRest.z + shinRest.z - hipDepth
  const reach = Math.max(Math.abs(thigh - shin) + 0.000001, Math.min(thigh + shin - 0.000001, Math.hypot(vertical, depth)))
  const angle = Math.atan2(-depth, vertical)
  const thighOffset = Math.acos(Math.max(-1, Math.min(1, (thigh * thigh + reach * reach - shin * shin) / (2 * thigh * reach))))
  const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, (thigh * thigh + shin * shin - reach * reach) / (2 * thigh * shin))))
  const thighRestAngle = Math.atan2(-thighRest.z, -thighRest.y)
  const shinRestAngle = Math.atan2(-shinRest.z, -shinRest.y)
  const upper = angle - thighOffset - thighRestAngle
  const lower = knee + thighRestAngle - shinRestAngle
  pose[`${side}UpperLeg`] = [upper, 0, 0]
  pose[`${side}LowerLeg`] = [lower, 0, 0]
  pose[`${side}Foot`] = [-upper - lower, 0, 0]
}

/**
 * Builds original motion against the normalized rig. No model or animation asset is required.
 * Leg lengths set the hips height and planted-foot bend for each avatar.
 */
export function createProceduralClip(vrm: VRMCore, id: string, duration: number) {
  const rig = measureRig(vrm)
  const joints = new JointKinematics(vrm)
  const times: number[] = []
  const positions: number[] = []
  const rotations = new Map<VRMHumanBoneName, number[]>()
  const samples = Math.ceil(duration * 30)
  const euler = new Euler()
  const quaternion = new Quaternion()
  const hipsOffset = new Vector3()
  const bones = Object.keys(vrm.humanoid.normalizedHumanBones) as VRMHumanBoneName[]
  for (const bone of bones) {
    if (bone !== 'leftEye' && bone !== 'rightEye' && bone !== 'jaw')
      rotations.set(bone, [])
  }

  for (let frame = 0; frame <= samples; frame++) {
    const progress = frame / samples
    const phase = progress * Math.PI * 2 * (id === 'natural-idle' ? duration / 6 : 1)
    const hold = envelope(progress)
    const beat = Math.sin(phase)
    const pose: Pose = {}
    const leftArm: ArmPose = { elevation: 0.1, forward: 0.04, twist: 0, elbow: 0.2, wrist: 0 }
    const rightArm: ArmPose = { ...leftArm }
    let drop = 0
    let depth = 0

    switch (id) {
      case 'natural-idle': {
        drop += rig.height * 0.0015 * (1 - Math.cos(phase))
        pose.spine = [0.012 * beat, 0, 0.008 * Math.sin(phase * 2)]
        pose.chest = [-0.015 * beat, 0, -0.006 * Math.sin(phase * 2)]
        pose.head = [0.006 * beat, 0.012 * beat, 0]
        leftArm.forward += 0.02 * beat
        rightArm.forward -= 0.015 * beat
        leftArm.elevation += 0.01 * beat
        rightArm.elevation -= 0.01 * beat
        break
      }
      case 'bow': {
        drop += rig.height * 0.018 * hold
        depth = -rig.height * 0.018 * hold
        pose.spine = [0.65 * hold, 0, 0]
        pose.chest = [0.12 * hold, 0, 0]
        pose.neck = [0.08 * hold, 0, 0]
        pose.head = [0.1 * hold, 0, 0]
        leftArm.forward += 0.5 * hold
        rightArm.forward += 0.5 * hold
        break
      }
      case 'dance': {
        drop += rig.height * 0.016 * (1 - Math.cos(phase * 2))
        pose.spine = [0.04 * Math.sin(phase * 2), 0.12 * beat, 0.12 * beat]
        pose.chest = [0, -0.08 * beat, -0.07 * beat]
        pose.head = [0, -0.05 * beat, -0.05 * beat]
        leftArm.elevation = 0.65 + 0.22 * beat
        rightArm.elevation = 0.65 - 0.22 * beat
        leftArm.forward = -0.35 * beat
        rightArm.forward = 0.35 * beat
        leftArm.elbow = 0.65 + 0.25 * beat
        rightArm.elbow = 0.65 - 0.25 * beat
        break
      }
      case 'run-circle': {
        const gait = createRunGaitPose(phase, rig.height)
        Object.assign(pose, gait.pose)
        drop = gait.drop
        depth = gait.depth
        leftArm.forward = -0.65 * beat
        rightArm.forward = 0.65 * beat
        leftArm.elevation = rightArm.elevation = 0.12
        leftArm.elbow = rightArm.elbow = 1.25
        break
      }
      case 'wave': {
        rightArm.elevation += 1.95 * hold
        rightArm.twist = -0.65 * hold
        rightArm.elbow += (0.9 + 0.1 * Math.sin(phase * 3)) * hold
        rightArm.wrist = 0.25 * Math.sin(phase * 3) * hold
        pose.spine = [0, -0.06 * hold, 0]
        pose.head = [0, -0.05 * hold, -0.05 * hold]
        break
      }
      case 'nod': {
        pose.head = [0.2 * Math.sin(phase * 2) * hold, 0, 0]
        pose.neck = [0.04 * Math.sin(phase * 2) * hold, 0, 0]
        break
      }
      case 'shake-head': {
        pose.head = [0, 0.28 * Math.sin(phase * 2) * hold, 0]
        break
      }
      case 'celebrate': {
        drop += rig.height * 0.018 * (1 - Math.cos(phase * 2)) * hold
        leftArm.elevation = rightArm.elevation = 0.1 + 2.4 * hold
        leftArm.forward = rightArm.forward = 0.12 * hold
        leftArm.twist = rightArm.twist = -0.4 * hold
        leftArm.elbow = rightArm.elbow = 0.12 + 0.23 * hold
        pose.chest = [-0.07 * hold, 0, 0]
        break
      }
      case 'stretch': {
        leftArm.elevation = rightArm.elevation = 0.1 + 2.7 * hold
        leftArm.twist = rightArm.twist = -0.2 * hold
        pose.spine = [0, 0, 0.12 * beat * hold]
        pose.chest = [-0.04 * hold, 0, 0.08 * beat * hold]
        break
      }
      case 'present': {
        rightArm.elevation += 0.7 * hold
        rightArm.forward += 0.25 * hold
        rightArm.twist = -0.55 * hold
        rightArm.elbow += 0.6 * hold
        rightArm.wrist = -0.3 * hold
        pose.spine = [0, -0.1 * hold, 0]
        pose.head = [0, -0.15 * hold, 0]
        break
      }
      default:
        throw new Error(`Procedural motion "${id}" is not defined.`)
    }

    if (id !== 'run-circle') {
      plantLeg(pose, 'left', joints.restSegment('leftLowerLeg'), joints.restSegment('leftFoot'), drop, depth)
      plantLeg(pose, 'right', joints.restSegment('rightLowerLeg'), joints.restSegment('rightFoot'), drop, depth)
    }
    times.push(progress * duration)
    joints.displacement(hipsOffset.set(0, -drop, depth)).add(rig.hipsPosition).toArray(positions, positions.length)
    const arms = new Map([...joints.arm('left', leftArm), ...joints.arm('right', rightArm)])
    for (const [bone, values] of rotations) {
      const angles = pose[bone]
      euler.set(angles?.[0] ?? 0, angles?.[1] ?? 0, angles?.[2] ?? 0, 'XYZ')
      const arm = arms.get(bone)
      if (arm)
        arm.toArray(values, values.length)
      else
        joints.rotation(quaternion.setFromEuler(euler)).toArray(values, values.length)
    }
  }

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = []
  for (const [bone, values] of rotations) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone)
    if (node)
      tracks.push(new QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, values))
  }
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')
  if (hips)
    tracks.push(new VectorKeyframeTrack(`${hips.uuid}.position`, times, positions))
  return new AnimationClip(id, duration, tracks)
}

/** Preserves the bundled idle body and finger tracks while its arms use the avatar's measured rest geometry. */
export function createRelaxedIdleClip(source: AnimationClip, vrm: VRMCore) {
  const armTargets = new Set<string>()
  for (const side of ['left', 'right'] as const) {
    for (const part of ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const) {
      const node = vrm.humanoid.getNormalizedBoneNode(`${side}${part}`)
      if (node) {
        armTargets.add(`${node.uuid}.quaternion`)
        armTargets.add(`${node.name}.quaternion`)
      }
    }
  }
  const relaxed = createProceduralClip(vrm, 'natural-idle', source.duration)
  return new AnimationClip(source.name, source.duration, [
    ...source.tracks.filter(track => !armTargets.has(track.name)),
    ...relaxed.tracks.filter(track => armTargets.has(track.name)),
  ], source.blendMode)
}
