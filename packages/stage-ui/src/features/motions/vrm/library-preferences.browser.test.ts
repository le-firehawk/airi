import { describe, expect, it } from 'vitest'

import { defaultMotionPreferences, readMotionPreferences, updateMotionPreferences } from './library'

describe('avatar motion preferences', () => {
  it('saves 32 chat motions and rejects a 33rd without losing the saved choices', async () => {
    const modelId = `motion-limit-${crypto.randomUUID()}`
    const aiMotionIds = Array.from({ length: 32 }, (_, index) => `local-test-${index}`)
    await updateMotionPreferences(modelId, { aiMotionIds })
    expect((await readMotionPreferences(modelId)).aiMotionIds).toEqual(aiMotionIds)

    await expect(updateMotionPreferences(modelId, { aiMotionIds: [...aiMotionIds, 'local-test-32'] })).rejects.toThrow()
    expect((await readMotionPreferences(modelId)).aiMotionIds).toEqual(aiMotionIds)
  })

  it('saves each new idle per avatar without opting idle motions into chat', async () => {
    const firstId = `motion-idle-${crypto.randomUUID()}`
    const secondId = `motion-idle-${crypto.randomUUID()}`
    await updateMotionPreferences(firstId, { idleId: 'attentive-idle' })
    await updateMotionPreferences(secondId, { idleId: 'thoughtful-idle' })

    const first = await readMotionPreferences(firstId)
    const second = await readMotionPreferences(secondId)
    expect(first.idleId).toBe('attentive-idle')
    expect(second.idleId).toBe('thoughtful-idle')
    expect(first.aiMotionIds).toEqual(defaultMotionPreferences().aiMotionIds)
    expect(second.aiMotionIds).toEqual(defaultMotionPreferences().aiMotionIds)
    expect(first.aiMotionIds).not.toContain('attentive-idle')
    expect(second.aiMotionIds).not.toContain('thoughtful-idle')
    expect(defaultMotionPreferences().idleId).toBe('default-idle')
  })
})
