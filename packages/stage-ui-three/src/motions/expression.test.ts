import { VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm-core'
import { BufferGeometry, Float32BufferAttribute, Mesh } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { useVRMEmote } from '../composables/vrm/expression'
import { createTestVrm } from '../test-utils/vrm'
import { updateMotionExpressions } from './expression'

function createFace() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
  const names = ['happy', 'aa', 'blink', 'sad', 'neutral']
  geometry.morphAttributes.position = names.map(() => new Float32BufferAttribute([0, 0, 0], 3))
  const mesh = new Mesh(geometry)
  const manager = new VRMExpressionManager()
  names.forEach((name, index) => {
    const expression = new VRMExpression(name)
    expression.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index, weight: 1 }))
    manager.registerExpression(expression)
  })
  return { manager, mesh }
}

const cue = { smile: 0.6, mouth: 0.24, squint: 0.3 }
const unowned = { speech: false, emote: false }

describe('motion expression composition', () => {
  it('renders the cue without retaining its weights or accumulating across frames', () => {
    const { manager, mesh } = createFace()
    manager.setValue('happy', 0.1)
    manager.setValue('aa', 0.05)
    manager.setValue('blink', 0.4)

    for (let frame = 0; frame < 180; frame++)
      updateMotionExpressions(manager, cue, unowned)

    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.6)
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(0.24)
    expect(mesh.morphTargetInfluences?.[2]).toBeCloseTo(0.4)
    expect(manager.getValue('happy')).toBe(0.1)
    expect(manager.getValue('aa')).toBe(0.05)
    expect(manager.getValue('blink')).toBe(0.4)

    updateMotionExpressions(manager, undefined, unowned)
    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.1)
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(0.05)
  })

  it('preserves current speech visemes on the first takeover frame', () => {
    const { manager, mesh } = createFace()
    updateMotionExpressions(manager, cue, unowned)
    manager.setValue('aa', 0.73)
    updateMotionExpressions(manager, cue, { speech: true, emote: false })

    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(0.6)
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(0.73)
    expect(mesh.morphTargetInfluences?.[2]).toBe(0)
    expect(manager.getValue('aa')).toBe(0.73)
  })

  it('yields a smile with a mouth override while speech owns the face', () => {
    const { manager, mesh } = createFace()
    manager.getExpression('happy')!.overrideMouth = 'block'
    manager.setValue('aa', 0.65)
    updateMotionExpressions(manager, cue, { speech: true, emote: false })

    expect(mesh.morphTargetInfluences?.[0]).toBe(0)
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(0.65)
    expect(manager.getExpression('happy')!.overrideMouth).toBe('block')
  })

  it('composes authored eye squint without taking ownership of blink state', () => {
    const { manager, mesh } = createFace()
    manager.getExpression('happy')!.overrideBlink = 'blend'
    manager.setValue('blink', 0.75)
    updateMotionExpressions(manager, cue, unowned)

    expect(mesh.morphTargetInfluences?.[2]).toBeCloseTo(0.75 * (1 - cue.smile))
    expect(manager.getValue('blink')).toBe(0.75)
    updateMotionExpressions(manager, undefined, unowned)
    expect(mesh.morphTargetInfluences?.[2]).toBeCloseTo(0.75)
  })

  it('adds a temporary squint while preserving full procedural blinks and their release', () => {
    const { manager, mesh } = createFace()
    updateMotionExpressions(manager, cue, unowned)
    expect(mesh.morphTargetInfluences?.[2]).toBeCloseTo(cue.squint)
    expect(manager.getValue('blink')).toBe(0)

    manager.setValue('blink', 1)
    updateMotionExpressions(manager, cue, unowned)
    expect(mesh.morphTargetInfluences?.[2]).toBe(1)
    expect(manager.getValue('blink')).toBe(1)

    manager.setValue('blink', 0.1)
    updateMotionExpressions(manager, cue, unowned)
    expect(mesh.morphTargetInfluences?.[2]).toBeCloseTo(cue.squint)
    expect(manager.getValue('blink')).toBe(0.1)
    updateMotionExpressions(manager, undefined, unowned)
    expect(mesh.morphTargetInfluences?.[2]).toBeCloseTo(0.1)
  })

  it('leaves only the current procedural blink during speech', () => {
    const { manager, mesh } = createFace()
    manager.setValue('blink', 0.05)
    updateMotionExpressions(manager, cue, { speech: true, emote: false })
    expect(mesh.morphTargetInfluences?.[2]).toBeCloseTo(0.05)
    expect(manager.getValue('blink')).toBe(0.05)
  })

  it('leaves explicit emotes and their neutral transitions in control', () => {
    const { manager, mesh } = createFace()
    const emote = useVRMEmote(createTestVrm({ expressionManager: manager }))
    emote.setEmotion('sad')
    emote.update(0.4)
    updateMotionExpressions(manager, cue, { speech: false, emote: emote.currentEmotion.value !== null })

    expect(mesh.morphTargetInfluences?.[0]).toBe(0)
    expect(mesh.morphTargetInfluences?.[1]).toBe(0)
    expect(mesh.morphTargetInfluences?.[2]).toBe(0)
    expect(mesh.morphTargetInfluences?.[3]).toBeCloseTo(0.7)

    emote.setEmotion('neutral')
    emote.update(0.3)
    updateMotionExpressions(manager, cue, { speech: false, emote: emote.currentEmotion.value !== null })
    expect(mesh.morphTargetInfluences?.[0]).toBe(0)
    expect(mesh.morphTargetInfluences?.[3]).toBeGreaterThan(0)
    emote.update(0.3)
    updateMotionExpressions(manager, cue, { speech: false, emote: emote.currentEmotion.value !== null })
    expect(mesh.morphTargetInfluences?.[0]).toBeCloseTo(cue.smile)
    expect(mesh.morphTargetInfluences?.[3]).toBe(0)
    emote.dispose()
  })

  it('respects a mouth-only explicit emote even when it does not suppress blinking', () => {
    const { manager, mesh } = createFace()
    const emote = useVRMEmote(createTestVrm({ expressionManager: manager }))
    emote.addEmotionState('mouth', { expression: [{ name: 'aa', value: 0.15 }], blendDuration: 0.1 })
    emote.setEmotion('mouth')
    emote.update(0.1)
    expect(emote.isEmoteActive.value).toBe(false)
    updateMotionExpressions(manager, cue, { speech: false, emote: emote.currentEmotion.value !== null })
    expect(mesh.morphTargetInfluences?.[0]).toBe(0)
    expect(mesh.morphTargetInfluences?.[1]).toBeCloseTo(0.15)
    emote.dispose()
  })

  it('does not snap binary presets or require missing presets', () => {
    const { manager, mesh } = createFace()
    manager.getExpression('happy')!.isBinary = true
    manager.getExpression('blink')!.isBinary = true
    manager.unregisterExpression(manager.getExpression('aa')!)
    updateMotionExpressions(manager, cue, unowned)
    expect(mesh.morphTargetInfluences?.[0]).toBe(0)
    expect(mesh.morphTargetInfluences?.[2]).toBe(0)
    expect(manager.getValue('aa')).toBeNull()
    expect(() => updateMotionExpressions(undefined, cue, unowned)).not.toThrow()
  })

  it('restores weights even if mesh expression evaluation throws', () => {
    const { manager } = createFace()
    manager.setValue('happy', 0.1)
    manager.setValue('aa', 0.05)
    manager.setValue('blink', 0.1)
    vi.spyOn(manager, 'update').mockImplementationOnce(() => {
      throw new Error('bind failure')
    })

    expect(() => updateMotionExpressions(manager, cue, unowned)).toThrow('bind failure')
    expect(manager.getValue('happy')).toBe(0.1)
    expect(manager.getValue('aa')).toBe(0.05)
    expect(manager.getValue('blink')).toBe(0.1)
  })
})
