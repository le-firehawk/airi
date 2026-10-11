import type { VRMCore, VRMHumanBoneName } from '@pixiv/three-vrm-core'

import { Matrix4, Quaternion, Vector3 } from 'three'

/** Anatomical arm angles in radians. Elevation starts at the hanging arm, and elbow flexion stays positive. */
export interface ArmPose {
  elevation: number
  forward: number
  twist: number
  elbow: number
  wrist: number
}

type Side = 'left' | 'right'

const xAxis = new Vector3(1, 0, 0)
const yAxis = new Vector3(0, 1, 0)
const zAxis = new Vector3(0, 0, 1)

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function direction(value: Vector3, fallback: Vector3) {
  return value.lengthSq() > 0.00000001 ? value.normalize() : value.copy(fallback)
}

/**
 * Captures anatomical axes and arm rest directions for built-in clips only.
 * Normalized VRM bones retain source rest offsets, including the opposite facing directions of VRM 0 and VRM 1.
 * Current bone poses and placement transforms never enter these measurements.
 */
export class JointKinematics {
  private readonly frame: Quaternion
  private readonly inverseFrame: Quaternion
  private readonly arms: Record<Side, { upper: Quaternion, lower: Quaternion, shoulder: boolean }>

  constructor(private readonly vrm: VRMCore) {
    const up = new Vector3()
    for (const name of ['spine', 'chest', 'upperChest', 'neck', 'head'] as const)
      up.add(this.restOffset(name))
    direction(up, yAxis)
    const left = this.restOffset('leftUpperLeg').sub(this.restOffset('rightUpperLeg'))
    left.addScaledVector(up, -left.dot(up))
    // A zero-width pelvis has no lateral axis. Its shoulder span supplies the same anatomical direction.
    if (left.lengthSq() < 0.00000001) {
      left.copy(this.restOffset('leftUpperArm')).add(this.restOffset('leftShoulder')).sub(this.restOffset('rightUpperArm')).sub(this.restOffset('rightShoulder'))
      left.addScaledVector(up, -left.dot(up))
    }
    if (left.lengthSq() < 0.00000001) {
      left.copy(Math.abs(up.x) < 0.9 ? xAxis : zAxis)
      left.addScaledVector(up, -left.dot(up))
    }
    left.normalize()
    const forward = new Vector3().crossVectors(left, up).normalize()
    this.frame = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(left, up, forward))
    this.inverseFrame = this.frame.clone().invert()
    this.arms = { left: this.measureArm('left'), right: this.measureArm('right') }
  }

  private restOffset(name: VRMHumanBoneName) {
    const position = this.vrm.humanoid.normalizedRestPose[name]?.position
    return position ? new Vector3().fromArray(position) : new Vector3()
  }

  /** Returns a rest segment in anatomical coordinates, with character-left along X and forward along Z. */
  restSegment(name: VRMHumanBoneName) {
    return this.restOffset(name).applyQuaternion(this.inverseFrame)
  }

  /** Converts a canonical rotation without changing the avatar, its scene, or imported clips. */
  rotation(value: Quaternion) {
    return value.premultiply(this.frame).multiply(this.inverseFrame)
  }

  /** Converts hips displacement into the same source coordinates as the normalized rest position. */
  displacement(value: Vector3) {
    return value.applyQuaternion(this.frame)
  }

  private measureArm(side: Side) {
    const axis = new Vector3(side === 'left' ? 1 : -1, 0, 0)
    return {
      upper: new Quaternion().setFromUnitVectors(axis, direction(this.restSegment(`${side}LowerArm`), axis)),
      lower: new Quaternion().setFromUnitVectors(axis, direction(this.restSegment(`${side}Hand`), axis)),
      shoulder: this.vrm.humanoid.getNormalizedBoneNode(`${side}Shoulder`) !== null,
    }
  }

  /** Solves one arm with rest corrections, a single elbow hinge, and shared clavicle elevation. */
  arm(side: Side, pose: ArmPose) {
    const sign = side === 'left' ? 1 : -1
    const rest = this.arms[side]
    const elevation = clamp(pose.elevation, 0.04, 2.85)
    // Above 60 degrees, the clavicle carries part of arm elevation. Rigs without it retain the hand target.
    const shoulder = rest.shoulder ? clamp((elevation - Math.PI / 3) * 0.35, 0, 0.45) : 0
    const clavicle = new Quaternion().setFromAxisAngle(zAxis, sign * shoulder)
    const upper = clavicle.clone().invert()
    upper.multiply(new Quaternion().setFromAxisAngle(xAxis, -clamp(pose.forward, -0.8, 1.2)))
    upper.multiply(new Quaternion().setFromAxisAngle(zAxis, sign * (elevation - Math.PI / 2)))
    upper.multiply(new Quaternion().setFromAxisAngle(xAxis, clamp(pose.twist, -1.4, 1.4)))
    upper.multiply(rest.upper.clone().invert())
    const lower = rest.upper.clone()
      .multiply(new Quaternion().setFromAxisAngle(yAxis, -sign * clamp(pose.elbow, 0.04, 2.2)))
      .multiply(rest.lower.clone().invert())
    const hand = rest.lower.clone()
      .multiply(new Quaternion().setFromAxisAngle(zAxis, sign * clamp(pose.wrist, -0.45, 0.45)))
      .multiply(rest.lower.clone().invert())
    return new Map<VRMHumanBoneName, Quaternion>([
      [`${side}Shoulder`, this.rotation(clavicle)],
      [`${side}UpperArm`, this.rotation(upper)],
      [`${side}LowerArm`, this.rotation(lower)],
      [`${side}Hand`, this.rotation(hand)],
    ])
  }
}
