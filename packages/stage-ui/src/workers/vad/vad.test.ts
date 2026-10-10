import { AutoModel, PretrainedConfig, PreTrainedModel, Tensor } from '@huggingface/transformers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VAD } from './vad'

vi.mock('@huggingface/transformers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@huggingface/transformers')>()

  return {
    ...actual,
    AutoModel: {
      from_pretrained: vi.fn(),
    },
  }
})

function createProbabilityModel(probabilities: number[]) {
  const model = new PreTrainedModel(new PretrainedConfig({ model_type: 'custom' }), {}, {})
  vi.spyOn(model, 'forward').mockImplementation(async (input: { state: Tensor }) => ({
    stateN: input.state,
    output: new Tensor('float32', new Float32Array([probabilities.shift() ?? 0]), [1]),
  }))
  return model
}

describe('vad speech duration', () => {
  beforeEach(() => {
    vi.mocked(AutoModel.from_pretrained).mockReset()
  })

  it('rejects a noise pulse that is shorter than the minimum speech duration', async () => {
    // ROOT CAUSE:
    //
    // The minimum speech check used the full segment buffer. That buffer also
    // contained the silence that closed the segment. An 800 ms silence period
    // therefore made a short noise pulse pass a 300 ms speech requirement.
    //
    // We count detected speech samples separately from post-speech silence.
    const probabilities = [0.9, ...Array.from<number>({ length: 80 }).fill(0)]
    vi.mocked(AutoModel.from_pretrained).mockResolvedValue(createProbabilityModel(probabilities))
    const vad = new VAD({
      sampleRate: 16000,
      newBufferSize: 160,
      minSilenceDurationMs: 800,
      minSpeechDurationMs: 300,
    })
    const onSpeechReady = vi.fn()
    const onSpeechCancel = vi.fn()
    vad.on('speech-ready', onSpeechReady)
    vad.on('speech-cancel', onSpeechCancel)

    await vad.initialize()
    for (let index = 0; index < 81; index++)
      await vad.processAudio(new Float32Array(160))

    expect(onSpeechReady).not.toHaveBeenCalled()
    expect(onSpeechCancel).toHaveBeenCalledOnce()
  })

  it('keeps speech that reaches the minimum speech duration', async () => {
    const probabilities = [
      ...Array.from<number>({ length: 30 }).fill(0.9),
      ...Array.from<number>({ length: 80 }).fill(0),
    ]
    vi.mocked(AutoModel.from_pretrained).mockResolvedValue(createProbabilityModel(probabilities))
    const vad = new VAD({
      sampleRate: 16000,
      newBufferSize: 160,
      minSilenceDurationMs: 800,
      minSpeechDurationMs: 300,
    })
    const onSpeechReady = vi.fn()
    vad.on('speech-ready', onSpeechReady)

    await vad.initialize()
    for (let index = 0; index < 110; index++)
      await vad.processAudio(new Float32Array(160))

    expect(onSpeechReady).toHaveBeenCalledOnce()
  })

  it('serializes overlapping worklet callbacks across consecutive speech segments', async () => {
    // ROOT CAUSE:
    // AudioWorklet callbacks do not await processing. Concurrent chunks captured stale recording
    // state even though inference was queued, losing segment transitions.
    // The complete detection and state transition now runs serially for each chunk.
    const probabilities = [
      ...Array.from<number>({ length: 30 }).fill(0.9),
      ...Array.from<number>({ length: 80 }).fill(0),
      ...Array.from<number>({ length: 30 }).fill(0.9),
      ...Array.from<number>({ length: 80 }).fill(0),
    ]
    vi.mocked(AutoModel.from_pretrained).mockResolvedValue(createProbabilityModel(probabilities))
    const vad = new VAD({
      sampleRate: 16000,
      newBufferSize: 160,
      minSilenceDurationMs: 800,
      minSpeechDurationMs: 300,
    })
    const onSpeechReady = vi.fn()
    vad.on('speech-ready', onSpeechReady)

    await vad.initialize()
    await Promise.all(Array.from({ length: 220 }, () => vad.processAudio(new Float32Array(160))))

    expect(onSpeechReady).toHaveBeenCalledTimes(2)
  })
})
