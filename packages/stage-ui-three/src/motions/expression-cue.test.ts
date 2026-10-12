import { AnimationClip, Group, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { createTestVrm } from '../test-utils/vrm'
import { MotionController } from './controller'
import { sampleLaughPhrase } from './laugh'

function createController() {
  const vrm = createTestVrm()
  const root = new Group()
  root.add(vrm.scene)
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')!
  const idle = new AnimationClip('idle', 4, [new VectorKeyframeTrack(`${hips.name}.position`, [0, 4], [...hips.position.toArray(), ...hips.position.toArray()])])
  return { controller: new MotionController(vrm, idle, root), idle }
}

describe('laugh expression cue lifetime', () => {
  it('follows the actual clip phase and playback speed', async () => {
    const { controller } = createController()
    expect(controller.expressionCue).toBeUndefined()
    await controller.play('laugh', { speed: 2 })
    controller.update(0.45)
    const phrase = sampleLaughPhrase(0.25)
    expect(controller.expressionCue?.smile).toBeCloseTo(phrase.smile)
    expect(controller.expressionCue?.mouth).toBeCloseTo(phrase.mouth)
    expect(controller.expressionCue?.squint).toBeCloseTo(phrase.squint)
    controller.update(1.36)
    expect(controller.expressionCue).toBeUndefined()
    controller.dispose()
  })

  it('fades a stopped laugh with its outgoing body action', async () => {
    const { controller } = createController()
    await controller.play('laugh')
    controller.update(0.9)
    const before = controller.expressionCue
    controller.stop()
    expect(controller.expressionCue).toEqual(before)
    controller.update(0.1)
    const phrase = sampleLaughPhrase(1 / 3.6)
    expect(controller.expressionCue?.smile).toBeCloseTo(phrase.smile * 2 / 3)
    expect(controller.expressionCue?.mouth).toBeCloseTo(phrase.mouth * 2 / 3)
    expect(controller.expressionCue?.squint).toBeCloseTo(phrase.squint * 2 / 3)
    controller.update(0.21)
    expect(controller.expressionCue).toBeUndefined()
    controller.dispose()
  })

  it('retains outgoing cues through replacement and repeated laugh requests', async () => {
    const { controller } = createController()
    await controller.play('laugh')
    controller.update(0.9)
    await controller.play('laugh')
    controller.update(0.15)
    const outgoing = sampleLaughPhrase(1.05 / 3.6)
    const incoming = sampleLaughPhrase(0.15 / 3.6)
    expect(controller.expressionCue?.smile).toBeCloseTo((outgoing.smile + incoming.smile) / 2)
    expect(controller.expressionCue?.mouth).toBeCloseTo((outgoing.mouth + incoming.mouth) / 2)
    expect(controller.expressionCue?.squint).toBeCloseTo((outgoing.squint + incoming.squint) / 2)

    await controller.play('wave')
    expect(controller.expressionCue?.smile).toBeGreaterThan(0)
    controller.update(0.31)
    expect(controller.expressionCue).toBeUndefined()
    controller.dispose()
  })

  it('samples identical phases after each loop without accumulating weights', async () => {
    const { controller } = createController()
    await controller.play('laugh', { loop: true, duration: 30 })
    controller.update(0.9)
    const first = controller.expressionCue!
    for (let cycle = 0; cycle < 6; cycle++) {
      controller.update(3.6)
      expect(controller.expressionCue?.smile).toBeCloseTo(first.smile)
      expect(controller.expressionCue?.mouth).toBeCloseTo(first.mouth)
      expect(controller.expressionCue?.squint).toBeCloseTo(first.squint)
    }
    controller.dispose()
  })

  it('clears cues immediately for detached reset and disposal', async () => {
    const { controller } = createController()
    await controller.play('laugh')
    controller.update(0.9)
    controller.reset()
    expect(controller.expressionCue).toBeUndefined()
    await controller.play('laugh')
    controller.update(0.9)
    controller.dispose()
    expect(controller.expressionCue).toBeUndefined()
  })

  it('does not assign the built-in cue to an imported clip with the same name', async () => {
    const { controller, idle } = createController()
    controller.catalog.register({ id: 'laugh', name: 'Imported laugh', category: 'gesture', duration: 3.6, source: 'imported', loop: false }, () => new AnimationClip('imported', 3.6, idle.tracks))
    expect(await controller.play('laugh')).toBe(true)
    controller.update(0.9)
    expect(controller.expressionCue).toBeUndefined()
    controller.dispose()
  })
})
