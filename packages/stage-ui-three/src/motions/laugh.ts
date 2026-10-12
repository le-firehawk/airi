type Key = readonly [progress: number, value: number]

function ease(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function sample(progress: number, keys: readonly Key[]) {
  for (let index = 1; index < keys.length; index++) {
    const [end, to] = keys[index]
    if (progress > end)
      continue
    const [start, from] = keys[index - 1]
    return from + (to - from) * ease((progress - start) / (end - start))
  }
  return keys[keys.length - 1][1]
}

const inhale: readonly Key[] = [[0, 0], [0.13, 1], [0.23, 0], [1, 0]]
const compressions: readonly Key[] = [
  [0, 0],
  [0.19, 0],
  [0.25, 1],
  [0.32, 0.12],
  [0.365, 0.72],
  [0.45, 0.06],
  [0.515, 0.52],
  [0.59, 0.02],
  [0.64, 0.26],
  [0.75, 0],
  [1, 0],
]
const gesture: readonly Key[] = [[0, 0], [0.08, 0], [0.29, 1], [0.66, 0.88], [0.83, 0.45], [1, 0]]
const recover: readonly Key[] = [[0, 0], [0.18, 0.12], [0.32, 1], [0.67, 0.7], [0.85, 0.2], [1, 0]]
const smile: readonly Key[] = [[0, 0], [0.17, 0.45], [0.32, 0.56], [0.66, 0.46], [0.83, 0.28], [1, 0]]

/**
 * Samples one authored laugh phrase in normalized clip time.
 * A preparatory breath leads four decaying exhalations, then the head and hands settle at separate times.
 * Body tracks and the optional facial cue share this timing. This function never owns expression weights.
 */
export function sampleLaughPhrase(progress: number) {
  const compression = sample(progress, compressions)
  return {
    inhale: sample(progress, inhale),
    compression,
    chest: sample(progress - 0.012, compressions),
    head: sample(progress - 0.038, compressions),
    recover: sample(progress, recover),
    gesture: sample(progress, gesture),
    smile: sample(progress, smile),
    mouth: 0.06 * sample(progress, recover) + 0.5 * compression,
    squint: 0.16 * sample(progress, recover) + 0.18 * sample(progress - 0.02, compressions),
  }
}
