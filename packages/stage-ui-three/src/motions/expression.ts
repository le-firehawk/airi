import type { VRMExpressionManager } from '@pixiv/three-vrm-core'

import type { MotionExpressionCue } from './types'

/** Speech owns visemes. An explicit emote owns the complete face until its neutral transition finishes. */
interface ExpressionOwners {
  speech: boolean
  emote: boolean
}

/**
 * Composes a motion cue for one mesh update, then restores the expression owners' weights.
 * Call after blink, speech, and emote updates. No cue survives in model state between frames or after detachment.
 */
export function updateMotionExpressions(
  manager: VRMExpressionManager | undefined,
  cue: MotionExpressionCue | undefined,
  owners: ExpressionOwners,
) {
  if (!manager)
    return
  if (!cue || owners.emote) {
    manager.update()
    return
  }

  const happy = manager.getExpression('happy')
  const mouth = manager.getExpression('aa')
  const blink = manager.getExpression('blink')
  // Binary presets cannot follow the phrase's smooth envelope without a visible snap.
  const applySmile = happy && !happy.isBinary && (!owners.speech || happy.overrideMouth === 'none')
  const applyMouth = mouth && !mouth.isBinary && !owners.speech
  const applySquint = blink && !blink.isBinary && !owners.speech
  const smileBase = happy?.weight ?? 0
  const mouthBase = mouth?.weight ?? 0
  const blinkBase = blink?.weight ?? 0

  try {
    if (applySmile)
      manager.setValue('happy', Math.max(smileBase, cue.smile))
    if (applyMouth)
      manager.setValue('aa', Math.max(mouthBase, cue.mouth))
    // Full procedural blinks take precedence over the phrase's partial eye closure.
    if (applySquint)
      manager.setValue('blink', Math.max(blinkBase, cue.squint))
    // Authored happy expressions can squint. The manager composes their blink override without changing the blink owner's state.
    manager.update()
  }
  finally {
    // Restoring inputs does not clear rendered mesh weights. The next update recomputes those weights from all current owners.
    if (applySmile)
      manager.setValue('happy', smileBase)
    if (applyMouth)
      manager.setValue('aa', mouthBase)
    if (applySquint)
      manager.setValue('blink', blinkBase)
  }
}
