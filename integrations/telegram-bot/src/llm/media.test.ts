import type { GenerateTextResult } from '@xsai/generate-text'
import type { File, Message, PhotoSize, Sticker } from 'grammy/types'

import type { BotContext } from '../types'

import { Buffer } from 'node:buffer'
import { stat } from 'node:fs/promises'

import { getGlobalLogLevel, LogLevel, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { embed } from '@xsai/embed'
import { generateText } from '@xsai/generate-text'
import { Bot } from 'grammy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { interpretAnimatedSticker } from './animated-sticker'
import { interpretPhotos } from './photo'
import { interpretSticker } from './sticker'

const database = vi.hoisted(() => {
  const rows: { file_id: string, description: string }[] = []
  return { rows, values: vi.fn() }
})

vi.mock('../db', () => ({
  useDrizzle: () => ({
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve(database.rows), {
          limit: () => Promise.resolve(database.rows),
        }),
      }),
    }),
    insert: () => ({ values: database.values }),
  }),
}))

vi.mock('@xsai/generate-text', () => ({ generateText: vi.fn() }))
vi.mock('@xsai/embed', () => ({ embed: vi.fn() }))

const frameExtraction = vi.hoisted(() => {
  const outputDirectories: string[] = []
  return { files: ['frame-001.png'], outputDirectories, removeOutputDirectory: false }
})

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

vi.mock('fluent-ffmpeg', async () => {
  const { EventEmitter } = await import('node:events')
  const { rm, writeFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')

  class FrameExtractor extends EventEmitter {
    private outputPath = ''

    outputOptions() {
      return this
    }

    output(outputPath: string) {
      this.outputPath = outputPath
      frameExtraction.outputDirectories.push(dirname(outputPath))
      return this
    }

    run() {
      const outputDirectory = dirname(this.outputPath)
      void Promise.all(frameExtraction.files.map(file => writeFile(join(outputDirectory, file), png)))
        .then(async () => {
          if (frameExtraction.removeOutputDirectory) {
            await rm(outputDirectory, { recursive: true, force: true })
          }
          this.emit('end', null, null)
        })
        .catch(error => this.emit('error', error))
    }
  }

  return { default: Object.assign(() => new FrameExtractor(), { setFfmpegPath: vi.fn() }) }
})

const photo: PhotoSize = { file_id: 'new-photo', file_unique_id: 'new-photo-unique', width: 1, height: 1 }
const sticker: Sticker = {
  file_id: 'media-test-sticker',
  file_unique_id: 'media-test-sticker-unique',
  type: 'regular',
  width: 1,
  height: 1,
  is_animated: false,
  is_video: false,
}
const message: Message.PhotoMessage = {
  message_id: 42,
  date: 1700000000,
  chat: { id: -100, type: 'channel', title: 'Art channel' },
  sender_chat: { id: -100, type: 'channel', title: 'Art channel' },
  photo: [photo],
  caption: 'Sunset over the sea',
}

function modelResult(text?: string): GenerateTextResult {
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  return {
    finishReason: 'stop',
    messages: [],
    steps: [],
    text,
    toolCalls: [],
    toolResults: [],
    totalUsage: usage,
    usage,
  }
}

function createState(): BotContext {
  return {
    bot: new Bot('123456:test-token'),
    messageQueue: [],
    unreadMessages: {},
    processedIds: new Set(),
    logger: useLogg('media-tests').withLogLevel(LogLevel.Error),
    processing: false,
    lastInteractedNChatIds: [],
    chats: new Map(),
  }
}

function mockFile(bot: Bot, filePath?: string) {
  return vi.spyOn(bot.api, 'getFile').mockImplementation(async (fileId): Promise<File> => ({
    file_id: fileId,
    file_unique_id: `${fileId}-unique`,
    file_path: filePath,
  }))
}

let originalLogLevel: LogLevel

beforeEach(() => {
  originalLogLevel = getGlobalLogLevel()
  setGlobalLogLevel(LogLevel.Error)
  database.rows.length = 0
  frameExtraction.files = ['frame-001.png']
  frameExtraction.outputDirectories.length = 0
  frameExtraction.removeOutputDirectory = false
  vi.clearAllMocks()
  vi.mocked(generateText).mockReset().mockResolvedValue(modelResult('<think>private reasoning</think>A sunset.'))
  vi.mocked(embed).mockResolvedValue({ embedding: [], input: '', usage: { prompt_tokens: 0, total_tokens: 0 } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array(png)))
})

afterEach(() => {
  setGlobalLogLevel(originalLogLevel)
  vi.restoreAllMocks()
})

describe('photo interpretation', () => {
  it('preserves channel sender and caption in the prompt', async () => {
    const state = createState()
    mockFile(state.bot, 'photos/new.png')

    await interpretPhotos(state, message, [photo])

    expect(generateText).toHaveBeenCalledOnce()
    const request = vi.mocked(generateText).mock.calls[0][0]
    expect(request.messages[0].content).toContain('Art channel')
    expect(request.messages[0].content).toContain(message.caption)
    expect(database.values).toHaveBeenCalledWith(expect.objectContaining({
      file_id: photo.file_id,
      image_path: 'photos/new.png',
      description: 'A sunset.',
    }))
  })

  it('keeps the uncached photo ID after an earlier photo is cached', async () => {
    const state = createState()
    const cachedPhoto = { ...photo, file_id: 'cached-photo' }
    const userMessage = { ...message, from: { id: 7, is_bot: false, first_name: 'Alice' }, photo: [cachedPhoto, photo] }
    database.rows.push({ file_id: cachedPhoto.file_id, description: 'Already described.' })
    const getFile = mockFile(state.bot, 'photos/new.png')

    await interpretPhotos(state, userMessage, userMessage.photo)

    expect(getFile).toHaveBeenCalledExactlyOnceWith(photo.file_id)
    expect(database.values).toHaveBeenCalledWith(expect.objectContaining({ file_id: photo.file_id }))
  })

  it('uses the supplied photos when the message has no photo field', async () => {
    const state = createState()
    mockFile(state.bot, 'photos/new.png')
    const textMessage: Message.TextMessage = {
      message_id: 43,
      date: message.date,
      chat: message.chat,
      text: 'Attached separately',
    }

    await interpretPhotos(state, textMessage, [photo])

    expect(database.values).toHaveBeenCalledWith(expect.objectContaining({ file_id: photo.file_id }))
    expect(vi.mocked(generateText).mock.calls[0][0].messages[0].content).toContain('Unknown sender')
  })

  it.each([undefined, '', '<think>reasoning only</think>'])('does not persist missing photo descriptions: %s', async (text) => {
    const state = createState()
    mockFile(state.bot, 'photos/new.png')
    vi.mocked(generateText).mockResolvedValue(modelResult(text))

    await interpretPhotos(state, message, [photo])

    expect(generateText).toHaveBeenCalledOnce()
    expect(embed).not.toHaveBeenCalled()
    expect(database.values).not.toHaveBeenCalled()
  })

  it('does not download a photo without a Telegram file path', async () => {
    const state = createState()
    mockFile(state.bot)

    await interpretPhotos(state, message, [photo])

    expect(fetch).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
    expect(database.values).not.toHaveBeenCalled()
  })
})

describe('sticker interpretation', () => {
  it('preserves channel stickers without a set name or emoji', async () => {
    const state = createState()
    mockFile(state.bot, 'stickers/new.webp')

    await interpretSticker(state.bot, message, sticker)

    expect(generateText).toHaveBeenCalledOnce()
    expect(vi.mocked(generateText).mock.calls[0][0].messages[0].content).toContain('Art channel')
    expect(database.values).toHaveBeenCalledWith(expect.objectContaining({
      file_id: sticker.file_id,
      description: 'A sunset.',
      name: '',
      emoji: '',
      label: '',
    }))
  })

  it('does not persist a missing sticker description', async () => {
    const state = createState()
    mockFile(state.bot, 'stickers/new.webp')
    vi.mocked(generateText).mockResolvedValue(modelResult())

    await interpretSticker(state.bot, message, sticker)

    expect(generateText).toHaveBeenCalledOnce()
    expect(database.values).not.toHaveBeenCalled()
  })

  it('does not download a sticker without a Telegram file path', async () => {
    const state = createState()
    mockFile(state.bot)

    await interpretSticker(state.bot, message, sticker)

    expect(fetch).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })
})

describe('animated sticker interpretation', () => {
  it('preserves video stickers without a set name or emoji', async () => {
    const state = createState()
    mockFile(state.bot, 'stickers/new.webm')
    vi.mocked(generateText)
      .mockResolvedValueOnce(modelResult('A single sunset frame.'))
      .mockResolvedValueOnce(modelResult('<think>private reasoning</think>A moving sunset.'))

    const result = await interpretSticker(state.bot, message, { ...sticker, is_video: true })

    expect(result).toBe('A moving sunset.')
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(generateText).mock.calls[1][0].messages[0].content).toContain('FRAME 1:\nA single sunset frame.')
    expect(database.values).toHaveBeenCalledWith(expect.objectContaining({
      description: 'A moving sunset.',
      name: '',
      emoji: '',
      label: '',
    }))
  })

  it('does not consolidate frames without descriptions', async () => {
    const state = createState()
    mockFile(state.bot, 'stickers/new.webm')
    vi.mocked(generateText).mockResolvedValue(modelResult())

    await interpretAnimatedSticker(state.bot, message, { ...sticker, is_video: true })

    expect(generateText).toHaveBeenCalledOnce()
    expect(database.values).not.toHaveBeenCalled()
  })

  it.each([undefined, '', '<think>reasoning only</think>'])('does not persist missing consolidation text: %s', async (text) => {
    const state = createState()
    mockFile(state.bot, 'stickers/new.webm')
    vi.mocked(generateText)
      .mockResolvedValueOnce(modelResult('A single sunset frame.'))
      .mockResolvedValueOnce(modelResult(text))

    await interpretAnimatedSticker(state.bot, message, { ...sticker, is_video: true })

    expect(generateText).toHaveBeenCalledTimes(2)
    expect(database.values).not.toHaveBeenCalled()
    await expect(stat(frameExtraction.outputDirectories[0])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not download an animated sticker without a Telegram file path', async () => {
    const state = createState()
    mockFile(state.bot)

    await interpretAnimatedSticker(state.bot, message, { ...sticker, is_video: true })

    expect(fetch).not.toHaveBeenCalled()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('ignores unrelated frame files', async () => {
    const state = createState()
    mockFile(state.bot, 'stickers/new.webm')
    frameExtraction.files = ['frame-001.png', 'preview-frame-002.png', 'frame-003.png.backup']

    await interpretAnimatedSticker(state.bot, message, { ...sticker, is_video: true })

    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('finishes when the extracted frame directory cannot be read', async () => {
    const state = createState()
    mockFile(state.bot, 'stickers/new.webm')
    frameExtraction.removeOutputDirectory = true

    await interpretAnimatedSticker(state.bot, message, { ...sticker, is_video: true })

    expect(generateText).not.toHaveBeenCalled()
    expect(database.values).not.toHaveBeenCalled()
  })
})
