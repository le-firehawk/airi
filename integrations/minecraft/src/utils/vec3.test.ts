import type { Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'

import { createRequire } from 'node:module'

import { Vec3 } from 'vec3'
import { describe, expect, expectTypeOf, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('minecraft vector contracts', () => {
  it.each(['mineflayer', 'mineflayer-pathfinder', 'prismarine-entity'])('uses the same vector implementation as %s', (dependency) => {
    const dependencyRequire = createRequire(require.resolve(dependency))

    expect(dependencyRequire.resolve('vec3')).toBe(require.resolve('vec3'))
  })

  it('accepts entity and block-search positions without conversion', () => {
    expectTypeOf<Entity['position']>().toMatchTypeOf<Vec3>()
    expectTypeOf<ReturnType<Bot['findBlocks']>[number]>().toMatchTypeOf<Vec3>()

    const position = new Vec3(1.5, 64, 2.5)
    const destination = position.offset(3, 0, 4)

    expect(position.distanceTo(destination)).toBe(5)
    expect(position.floored()).toEqual(new Vec3(1, 64, 2))
    expect(position).toEqual(new Vec3(1.5, 64, 2.5))
  })
})
