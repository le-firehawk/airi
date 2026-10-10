import type { AppleSpeechProviderOperations } from '@xsai-apple-speech/transcription'

import { createContext, defineInvoke } from '@moeru/eventa'
import { createAppleSpeechProvider } from '@xsai-apple-speech/transcription'
import { appleSpeechGenerate } from '@xsai-apple-speech/transcription-electron-plugin/events'
import { setupAppleSpeechTranscription } from '@xsai-apple-speech/transcription-electron-plugin/main'
import { expect, it, vi } from 'vitest'

import builderConfig from '../electron-builder.config'
import packageJson from '../package.json'

// https://github.com/le-firehawk/airi/actions/runs/38017667646/job/114111461965
// ROOT CAUSE:
// Electron had no desktopName, so its window identity differed from the installed desktop entry.
// Matching metadata and synchronized filenames retain the existing airi.desktop entry.
it('matches the Electron window identity to the Linux desktop entry', () => {
  expect(packageJson.desktopName).toBe(`${builderConfig.linux.executableName}.desktop`)
  expect(builderConfig.linux.syncDesktopName).toBe(true)
})

// https://github.com/le-firehawk/airi/actions/runs/38017667646/job/114111461965
// ROOT CAUSE:
// The plugin pinned a duplicate prerelease that the pnpm packaging collector omitted.
// Its scoped override uses the byte-identical stable transcription implementation.
it.each(['automatic', 'speech', 'dictation'] as const)('preserves Apple Speech %s batch generation through the installed plugin', async (transcriber) => {
  const context = createContext()
  const transcription = { locale: 'en-US', text: 'Hello AIRI' }
  const generate = vi.fn<AppleSpeechProviderOperations['generate']>(async () => transcription)
  const provider = createAppleSpeechProvider({
    generate,
    getLocales: async () => [{ installed: true, locale: 'en-US' }],
    isAvailable: async () => ({ available: true }),
    load: async () => {},
    start: async () => { throw new Error('Batch generation must not start streaming') },
  })
  const setup = setupAppleSpeechTranscription({ context, provider })
  const invoke = defineInvoke(context, appleSpeechGenerate)
  const audio = new Uint8Array([82, 73, 70, 70])

  try {
    const result = await invoke({
      audio,
      fileName: 'speech.wav',
      locale: 'en-US',
      mediaType: 'audio/wav',
      transcriber,
    })

    expect(result).toEqual(transcription)
    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      audio,
      fileName: 'speech.wav',
      locale: 'en-US',
      mediaType: 'audio/wav',
      transcriber,
    }))
    expect(generate.mock.calls[0]?.[0].abortSignal).toBeInstanceOf(AbortSignal)
  }
  finally {
    await setup.dispose()
  }
})
