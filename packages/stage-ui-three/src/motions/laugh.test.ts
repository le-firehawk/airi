import { describe, expect, it } from 'vitest'

import { sampleLaughPhrase } from './laugh'

describe('authored laugh phrase', () => {
  it('leads exhalation with a breath and smile, then lets the head follow the chest', () => {
    const breath = sampleLaughPhrase(0.13)
    expect(breath.inhale).toBe(1)
    expect(breath.compression).toBe(0)
    expect(breath.smile).toBeGreaterThan(0.35)
    const exhale = sampleLaughPhrase(0.25)
    expect(exhale.compression).toBe(1)
    expect(exhale.chest).toBeLessThan(exhale.compression)
    expect(exhale.head).toBeLessThan(exhale.chest)
  })

  it('uses four uneven decaying exhalations, followed by a quiet recovery', () => {
    const peaks: { progress: number, value: number }[] = []
    for (let sample = 1; sample < 1000; sample++) {
      const progress = sample / 1000
      const value = sampleLaughPhrase(progress).compression
      if (value > sampleLaughPhrase(progress - 0.001).compression && value >= sampleLaughPhrase(progress + 0.001).compression)
        peaks.push({ progress, value })
    }
    expect(peaks).toHaveLength(4)
    for (let index = 1; index < peaks.length; index++)
      expect(peaks[index].value).toBeLessThan(peaks[index - 1].value)
    const gaps = peaks.slice(1).map((peak, index) => peak.progress - peaks[index].progress)
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.025)
    expect(sampleLaughPhrase(0.8).compression).toBe(0)
    expect(sampleLaughPhrase(0.8).gesture).toBeGreaterThan(0)
    expect(sampleLaughPhrase(0.8).smile).toBeGreaterThan(0)
  })

  it('starts and ends at rest with finite smooth channels', () => {
    for (const progress of [-1, 0, 1, 2]) {
      for (const value of Object.values(sampleLaughPhrase(progress)))
        expect(value).toBe(0)
    }
    for (const progress of [0.00001, 0.99999]) {
      for (const value of Object.values(sampleLaughPhrase(progress)))
        expect(value).toBeLessThan(0.000001)
    }
    for (let frame = 0; frame <= 216; frame++) {
      const values = Object.values(sampleLaughPhrase(frame / 216))
      expect(values.every(Number.isFinite)).toBe(true)
      expect(values.every(value => value >= 0 && value <= 1)).toBe(true)
    }
  })
})
