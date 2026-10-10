import minecraftData from 'minecraft-data'

import { describe, expect, it } from 'vitest'

import { McData } from './mcdata'

const registry = minecraftData('1.21.4')

describe('mcData block suggestions', () => {
  it.each(['stone', 'oak_log', 'crafting_table'])('returns the exact block name for %s', (name) => {
    const data = new McData(registry)

    expect(data.getClosestBlockName(name)).toBe(name)
  })

  it.each([
    ['oak_lo', 'oak_log'],
    ['crafting_tabl', 'crafting_table'],
    ['stoxe', 'stone'],
  ])('finds the closest block name for %s', (input, expected) => {
    const data = new McData(registry)

    expect(data.getClosestBlockName(input)).toBe(expected)
  })

  it('returns null when the registry contains no blocks', () => {
    const data = new McData({ ...registry, blocksByName: {} })

    expect(data.getClosestBlockName('stone')).toBeNull()
  })
})
