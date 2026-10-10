import type { Buffer } from 'node:buffer'

import type { AutomaticSpeechRecognitionPipeline, PretrainedModelOptions } from '@huggingface/transformers'

import { env } from 'node:process'

import wavefile from 'wavefile'

import { useLogg } from '@guiiai/logg'
import { pipeline } from '@huggingface/transformers'
import { toWav } from '@proj-airi/audio'
import { createOpenAI } from '@xsai-ext/providers/create'
import { generateTranscription } from '@xsai/generate-transcription'

class WhisperPipeline {
  readonly task = 'automatic-speech-recognition'
  model = 'Xenova/whisper-medium.en'
  instance: AutomaticSpeechRecognitionPipeline | null = null

  async getInstance(progress_callback?: PretrainedModelOptions['progress_callback']) {
    if (this.instance === null) {
      this.instance = await pipeline(this.task, this.model, { progress_callback })
    }

    return this.instance
  }
}

export const WhisperLargeV3Pipeline = new WhisperPipeline()

export function textFromResult(result: Array<{ text: string }> | { text: string }) {
  // An empty batch contains no speech.
  return Array.isArray(result) ? result[0]?.text ?? '' : result.text
}

export async function transcribe(pcmBuffer: Buffer) {
  const log = useLogg('Memory:Transcribe').useGlobalConfig()

  const pcmConvertedWav = toWav(Uint8Array.from(pcmBuffer).buffer, 48000, 2)
  log.withFields({ from: pcmBuffer.byteLength, to: pcmConvertedWav.byteLength }).log('Audio data received')

  const transcriber = await WhisperLargeV3Pipeline.getInstance()
  log.log('Transcribing audio')

  const wav = new wavefile.WaveFile(new Uint8Array(pcmConvertedWav))
  wav.toBitDepth('32f') // Pipeline expects input as a Float32Array
  wav.toSampleRate(16000) // Whisper expects audio with a sampling rate of 16000
  const audioData = wav.getSamples()

  const result = await transcriber(audioData)
  const text = textFromResult(result)
  if (!text) {
    log.log('No transcription result')
    return ''
  }

  log.withField('result', text).log('Transcription result')
  return text
}

export async function openaiTranscribe(wavBuffer: Buffer) {
  const log = useLogg('Remote:Transcribe').useGlobalConfig()

  log.log('Transcribing audio...')

  try {
    // Local OpenAI-compatible endpoints can accept requests without authentication.
    const apiKey = env.OPENAI_STT_API_KEY?.trim() || undefined
    const model = env.OPENAI_STT_MODEL?.trim()
    if (!model) {
      throw new Error('OPENAI_STT_MODEL is required')
    }

    const wavFile = new Blob([Uint8Array.from(wavBuffer)], { type: 'audio/wav' })
    const openai = createOpenAI(apiKey ?? '', env.OPENAI_STT_API_BASE_URL || undefined)
    const result = await generateTranscription({
      ...openai.transcription(model),
      apiKey,
      file: wavFile,
    })

    log.withField('result', result.text).log('Transcription result')
    return result.text
  }
  catch (err) {
    log.withError(err).error('Failed to transcribe audio')
  }

  return ''
}
