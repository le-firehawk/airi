import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const app = createRequire(import.meta.url)
const stage = createRequire(app.resolve('@proj-airi/stage-ui/stores/settings'))
const motions = createRequire(app.resolve('@proj-airi/stage-ui-three/motions'))
const vrm = createRequire(motions.resolve('@pixiv/three-vrm'))
const animation = createRequire(motions.resolve('@pixiv/three-vrm-animation'))

describe('motion dependency identity', () => {
  it('uses the app Three.js package throughout the stage and VRM loaders', () => {
    const three = app.resolve('three')
    expect(stage.resolve('three')).toBe(three)
    expect(motions.resolve('three')).toBe(three)
    expect(vrm.resolve('three')).toBe(three)
    expect(animation.resolve('three')).toBe(three)
  })

  it('uses one VRM core package for models, animation imports, and the motion host', () => {
    const core = motions.resolve('@pixiv/three-vrm-core')
    expect(stage.resolve('@pixiv/three-vrm-core')).toBe(core)
    expect(vrm.resolve('@pixiv/three-vrm-core')).toBe(core)
    expect(animation.resolve('@pixiv/three-vrm-core')).toBe(core)
  })

  it('resolves the shared motion catalog through the same package export as the app', () => {
    expect(stage.resolve('@proj-airi/stage-ui-three/motions')).toBe(app.resolve('@proj-airi/stage-ui-three/motions'))
  })
})
