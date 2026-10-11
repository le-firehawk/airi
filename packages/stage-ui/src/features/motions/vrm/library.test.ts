import type { MotionMetadata } from '@proj-airi/stage-ui-three/motions'

import { createMotionCatalog } from '@proj-airi/stage-ui-three/motions'
import { describe, expect, it } from 'vitest'

import { builtinMotions, createMotionPrompt, defaultMotionPreferences } from './library'

describe('motion prompt selection', () => {
  it('exposes every catalog entry to the library with the separate relaxed idle', () => {
    const catalogEntries = createMotionCatalog().list()
    expect(builtinMotions).toEqual([
      ...catalogEntries,
      expect.objectContaining({ id: 'relaxed-idle', category: 'idle', source: 'builtin' }),
    ])
    expect(new Set(builtinMotions.map(entry => entry.id)).size).toBe(builtinMotions.length)
    expect(builtinMotions.map(entry => entry.id)).toEqual([
      'natural-idle',
      'bow',
      'dance',
      'run-circle',
      'wave',
      'nod',
      'shake-head',
      'celebrate',
      'stretch',
      'present',
      'blow-kiss',
      'laugh',
      'head-bob',
      'walk-circle',
      'shrug',
      'attentive-idle',
      'thoughtful-idle',
      'relaxed-idle',
    ])
  })

  it('allows the expanded actions by default and leaves all idle choices out of chat', () => {
    const preferences = defaultMotionPreferences()
    const prompt = createMotionPrompt(preferences, builtinMotions)
    expect(preferences.aiMotionIds).toEqual([
      'bow',
      'dance',
      'run-circle',
      'wave',
      'nod',
      'shake-head',
      'celebrate',
      'stretch',
      'present',
      'blow-kiss',
      'laugh',
      'head-bob',
      'walk-circle',
      'shrug',
    ])
    for (const id of ['blow-kiss', 'laugh', 'head-bob', 'walk-circle', 'shrug']) {
      expect(preferences.aiMotionIds).toContain(id)
      expect(prompt).toContain(`"id":"${id}"`)
    }
    for (const id of ['natural-idle', 'relaxed-idle', 'attentive-idle', 'thoughtful-idle']) {
      expect(builtinMotions.find(entry => entry.id === id)?.category).toBe('idle')
      expect(preferences.aiMotionIds).not.toContain(id)
      expect(prompt).not.toContain(`"id":"${id}"`)
    }
    expect(preferences.aiMotionIds.length).toBeLessThanOrEqual(32)
  })

  it('allows an idle only after the avatar explicitly selects it for chat', () => {
    const preferences = defaultMotionPreferences()
    preferences.aiMotionIds = ['thoughtful-idle']
    const prompt = createMotionPrompt(preferences, builtinMotions)
    expect(prompt).toContain('"id":"thoughtful-idle"')
    expect(prompt).not.toContain('"id":"attentive-idle"')
    expect(prompt).not.toContain('"id":"bow"')
  })

  it('keeps a large library available while listing only its 32 selected chat motions', () => {
    const imported: MotionMetadata[] = Array.from({ length: 50 }, (_, index) => ({
      id: `local-test-${index}`,
      name: `Imported ${index}`,
      category: 'gesture',
      duration: 2,
      loop: false,
      source: 'imported',
    }))
    const entries = [...builtinMotions, ...imported]
    const preferences = defaultMotionPreferences()
    const selected = imported.slice(9, 41)
    preferences.aiMotionIds = selected.map(entry => entry.id)
    const prompt = createMotionPrompt(preferences, entries)
    expect(prompt.split('\n')[1]).toBe(JSON.stringify(selected.map(({ id, name }) => ({ id, name }))))
    expect(entries).toHaveLength(builtinMotions.length + 50)
    expect(prompt).not.toContain('"id":"local-test-8"')
    expect(prompt).not.toContain('"id":"local-test-41"')
    expect(prompt).not.toContain('"id":"bow"')
  })

  it('keeps default preferences independent for each avatar', () => {
    const first = defaultMotionPreferences()
    const second = defaultMotionPreferences()
    first.aiMotionIds.length = 0
    expect(second.aiMotionIds).toContain('bow')
    expect(second.idleId).toBe('default-idle')
  })

  it('restricts chat actions to eligible IDs from the current catalog', () => {
    const preferences = defaultMotionPreferences()
    preferences.aiMotionIds = ['bow', 'missing']
    const prompt = createMotionPrompt(preferences, builtinMotions)
    expect(prompt).toContain('"id":"bow"')
    expect(prompt).not.toContain('"id":"dance"')
    expect(prompt).not.toContain('"id":"missing"')
    expect(prompt).toContain('"stop"')
  })

  it('omits motion instructions when no selected ID exists in the current catalog', () => {
    const preferences = defaultMotionPreferences()
    preferences.aiMotionIds = ['missing']
    expect(createMotionPrompt(preferences, builtinMotions)).toBe('')
    preferences.aiMotionIds = []
    expect(createMotionPrompt(preferences, builtinMotions)).toBe('')
  })

  it('omits disabled motion instructions', () => {
    const preferences = defaultMotionPreferences()
    preferences.aiEnabled = false
    expect(createMotionPrompt(preferences, builtinMotions)).toBe('')
  })
})
