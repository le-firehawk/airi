import type { VRMHumanBoneName } from '@pixiv/three-vrm-core'

/** Canonical gait rotations use +Z forward and +X toward the avatar's left side. */
export function createRunGaitPose(phase: number, height: number) {
  const stride = Math.sin(phase)
  const bounce = 1 - Math.cos(phase * 2)
  const pose: Partial<Record<VRMHumanBoneName, [number, number, number]>> = {
    hips: [0.035, 0.09 * stride, 0.045 * stride],
    spine: [0.12, -0.055 * stride, -0.025 * stride],
    chest: [0.025, -0.07 * stride, -0.02 * stride],
    head: [-0.12, 0.035 * stride, 0],
    leftUpperLeg: [-0.52 * stride, 0, 0.015],
    rightUpperLeg: [0.52 * stride, 0, -0.015],
    leftLowerLeg: [0.22 + 1.05 * Math.max(0, -stride), 0, 0],
    rightLowerLeg: [0.22 + 1.05 * Math.max(0, stride), 0, 0],
    leftFoot: [-0.12 - 0.5 * Math.max(0, -stride), 0, 0],
    rightFoot: [-0.12 - 0.5 * Math.max(0, stride), 0, 0],
  }
  return { pose, drop: height * 0.012 * bounce, depth: height * 0.008 * Math.sin(phase * 2) }
}
