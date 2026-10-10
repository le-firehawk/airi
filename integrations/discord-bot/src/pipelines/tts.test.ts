import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openaiTranscribe, textFromResult, transcribe, WhisperLargeV3Pipeline } from './tts'

const { modelPipeline, recognize } = vi.hoisted(() => ({
  modelPipeline: vi.fn(),
  recognize: vi.fn<(audio: Float64Array | Float64Array[]) => Promise<{ text: string }>>(),
}))

vi.mock('@huggingface/transformers', () => ({ pipeline: modelPipeline }))

const fetchTranscription = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchTranscription)
  vi.stubEnv('OPENAI_STT_API_KEY', 'test-key')
  vi.stubEnv('OPENAI_STT_MODEL', 'whisper-1')
  vi.stubEnv('OPENAI_STT_API_BASE_URL', 'https://speech.example/v1/')
  fetchTranscription.mockReset()
  fetchTranscription.mockResolvedValue(Response.json({ text: 'Hello from voice' }))
  modelPipeline.mockReset()
  recognize.mockReset()
  recognize.mockResolvedValue({ text: 'Local speech' })
  modelPipeline.mockResolvedValue(recognize)
  WhisperLargeV3Pipeline.instance = null
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('remote transcription', () => {
  it('uploads only the supplied Buffer slice', async () => {
    const storage = Buffer.from([99, 82, 73, 70, 70, 88])
    const audio = storage.subarray(1, 5)

    await expect(openaiTranscribe(audio)).resolves.toBe('Hello from voice')

    expect(fetchTranscription).toHaveBeenCalledOnce()
    const [url, request] = fetchTranscription.mock.calls[0]
    expect(String(url)).toBe('https://speech.example/v1/audio/transcriptions')
    const body = request?.body
    expect(body).toBeInstanceOf(FormData)
    if (!(body instanceof FormData))
      throw new Error('Expected a multipart transcription request')

    const file = body.get('file')
    expect(file).toBeInstanceOf(Blob)
    if (!(file instanceof Blob))
      throw new Error('Expected an audio Blob')

    expect(file.type).toBe('audio/wav')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(Uint8Array.from(audio))
    expect(body.get('model')).toBe('whisper-1')
  })

  it.each([
    ['OPENAI_STT_MODEL', undefined],
    ['OPENAI_STT_MODEL', ''],
    ['OPENAI_STT_MODEL', '   '],
  ])('skips requests when %s is missing or empty (%s)', async (name, value) => {
    vi.stubEnv(name, value)

    await expect(openaiTranscribe(Buffer.from('audio'))).resolves.toBe('')
    expect(fetchTranscription).not.toHaveBeenCalled()
  })

  it('supports a local endpoint without an API key', async () => {
    vi.stubEnv('OPENAI_STT_API_KEY', undefined)

    await expect(openaiTranscribe(Buffer.from('audio'))).resolves.toBe('Hello from voice')

    const headers = new Headers(fetchTranscription.mock.calls[0]?.[1]?.headers)
    expect(headers.has('authorization')).toBe(false)
  })

  it('uses the provider default when the optional endpoint is empty', async () => {
    vi.stubEnv('OPENAI_STT_API_BASE_URL', '')

    await openaiTranscribe(Buffer.from('audio'))

    expect(String(fetchTranscription.mock.calls[0]?.[0])).toBe('https://api.openai.com/v1/audio/transcriptions')
  })

  it('returns no transcript after a provider failure', async () => {
    fetchTranscription.mockRejectedValue(new Error('Speech service unavailable'))

    await expect(openaiTranscribe(Buffer.from('audio'))).resolves.toBe('')
  })
})

describe('local transcription', () => {
  it('creates a speech pipeline without a null progress callback', async () => {
    await WhisperLargeV3Pipeline.getInstance()
    await WhisperLargeV3Pipeline.getInstance()

    expect(modelPipeline).toHaveBeenCalledExactlyOnceWith(
      'automatic-speech-recognition',
      'Xenova/whisper-medium.en',
      { progress_callback: undefined },
    )
  })

  it('passes the requested progress callback to the model runtime', async () => {
    const progress = vi.fn()
    await WhisperLargeV3Pipeline.getInstance(progress)

    expect(modelPipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-medium.en',
      { progress_callback: progress },
    )
  })

  it('does not transcribe the bytes outside a PCM Buffer slice', async () => {
    const samples = new Float32Array(960).fill(0.25)
    const storage = Buffer.alloc(samples.byteLength + 128, 0xFF)
    Buffer.from(samples.buffer).copy(storage, 64)

    await expect(transcribe(storage.subarray(64, 64 + samples.byteLength))).resolves.toBe('Local speech')

    const [audio] = recognize.mock.calls[0]
    expect(Array.isArray(audio)).toBe(true)
    if (!Array.isArray(audio))
      throw new Error('Expected separate audio channels')

    expect(audio).toHaveLength(2)
    for (const channel of audio) {
      expect(channel).toBeInstanceOf(Float64Array)
      expect(channel).toHaveLength(160)
      expect(Array.from(channel).every(sample => Number.isFinite(sample))).toBe(true)
    }
  })

  it('extracts the first result and handles an empty batch', () => {
    expect(textFromResult({ text: 'one' })).toBe('one')
    expect(textFromResult([{ text: 'first' }, { text: 'second' }])).toBe('first')
    expect(textFromResult([])).toBe('')
  })
})
