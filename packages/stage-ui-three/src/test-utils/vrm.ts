import type { VRMExpressionManager } from '@pixiv/three-vrm-core'

import { VRM } from '@pixiv/three-vrm'
import { VRMHumanoid } from '@pixiv/three-vrm-core'
import { Group, Object3D } from 'three'

/**
 * Creates a complete humanoid for tests that do not load a model file.
 * @example
 * const vrm = createTestVrm()
 * vrm.humanoid.getNormalizedBoneNode('hips')
 */
export function createTestVrm(options: { scene?: Group, expressionManager?: VRMExpressionManager } = {}) {
  const scene = options.scene ?? new Group()
  function bone(parent: Object3D, x: number, y: number) {
    const node = new Object3D()
    node.position.set(x, y, 0)
    parent.add(node)
    return { node }
  }
  const hips = bone(scene, 0, 0.9)
  const spine = bone(hips.node, 0, 0.3)
  const leftUpperLeg = bone(hips.node, 0.1, -0.1)
  const leftLowerLeg = bone(leftUpperLeg.node, 0, -0.4)
  const rightUpperLeg = bone(hips.node, -0.1, -0.1)
  const rightLowerLeg = bone(rightUpperLeg.node, 0, -0.4)
  const leftUpperArm = bone(spine.node, 0.2, 0.1)
  const leftLowerArm = bone(leftUpperArm.node, 0.2, 0)
  const rightUpperArm = bone(spine.node, -0.2, 0.1)
  const rightLowerArm = bone(rightUpperArm.node, -0.2, 0)
  const humanoid = new VRMHumanoid({
    hips,
    spine,
    head: bone(spine.node, 0, 0.3),
    leftUpperLeg,
    leftLowerLeg,
    leftFoot: bone(leftLowerLeg.node, 0, -0.1),
    rightUpperLeg,
    rightLowerLeg,
    rightFoot: bone(rightLowerLeg.node, 0, -0.1),
    leftUpperArm,
    leftLowerArm,
    leftHand: bone(leftLowerArm.node, 0.2, 0),
    rightUpperArm,
    rightLowerArm,
    rightHand: bone(rightLowerArm.node, -0.2, 0),
  })
  scene.add(humanoid.normalizedHumanBonesRoot)
  const vrm = new VRM({
    scene,
    humanoid,
    expressionManager: options.expressionManager,
    meta: { metaVersion: '1', name: 'Test rig', authors: ['AIRI'], licenseUrl: 'https://opensource.org/license/mit' },
  })
  return vrm
}
