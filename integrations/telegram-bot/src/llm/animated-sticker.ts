import type { GenerateTextOptions } from '@xsai/generate-text'
import type { Bot } from 'grammy'
import type { Message, Sticker } from 'grammy/types'

import os from 'node:os'
import path from 'node:path'

import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import { env } from 'node:process'

import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffmpeg from 'fluent-ffmpeg'

import { useLogg } from '@guiiai/logg'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'

import { resolveMessageSender } from '../models/common'
import { findStickerDescription, recordSticker } from '../models/stickers'
import { div, span, ul } from '../prompts/utils'
import { toPngBase64FromFile } from './image'

ffmpeg.setFfmpegPath(ffmpegInstaller.path)

async function extractFrames(inputFilePath: string, outputDir: string, frameRate = 5) {
  await fs.mkdir(outputDir, { recursive: true })
  const outputPattern = path.join(outputDir, 'frame-%03d.png')

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputFilePath)
      .outputOptions(`-vf fps=${frameRate}`)
      .output(outputPattern)
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .run()
  })

  const files = await fs.readdir(outputDir)
  return files
    .flatMap((file) => {
      const frameNumber = /^frame-(\d+)\.png$/.exec(file)?.[1]
      return frameNumber ? [{ file, frameNumber: Number.parseInt(frameNumber, 10) }] : []
    })
    .sort((a, b) => a.frameNumber - b.frameNumber)
    .map(({ file }) => path.join(outputDir, file))
}

/** Extracts sticker frames and stores their nonempty consolidated description. */
export async function interpretAnimatedSticker(bot: Bot, msg: Message, sticker: Sticker) {
  const logger = useLogg('interpretAnimatedSticker')
    .useGlobalConfig()
    .withField('sticker_id', sticker.file_id)
    .withField('sticker_emoji', sticker.emoji)
    .withField('sticker_set', sticker.set_name)

  let tempDir: string | undefined

  try {
    if (await findStickerDescription(sticker.file_id)) {
      logger.log('Sticker already interpreted, skipping')
      return
    }

    const file = await bot.api.getFile(sticker.file_id)
    const filePath = file.file_path
    if (!filePath) {
      throw new Error(`Telegram returned no file path for sticker ${sticker.file_id}`)
    }

    const stickerRes = await fetch(`https://api.telegram.org/file/bot${bot.api.token}/${filePath}`)
    const buffer = await stickerRes.arrayBuffer()

    // Each interpretation owns its temporary files, including concurrent calls for the same sticker.
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sticker-'))
    const framesDir = path.join(tempDir, 'frames')
    const stickerPath = path.join(tempDir, path.basename(filePath))
    await fs.writeFile(stickerPath, Buffer.from(buffer))

    logger.withField('sticker_path', stickerPath).log('Sticker saved to temp file')

    const framePaths = await extractFrames(stickerPath, framesDir, 15)
    logger.withField('frame_paths', framePaths).log('Frames extracted')

    // Sample frames if too many (limit to ~5-8 frames for processing)
    let sampled = framePaths
    if (framePaths.length > 8) {
      const samplingRate = Math.ceil(framePaths.length / 8)
      sampled = framePaths.filter((_, i) => i % samplingRate === 0)
    }
    logger.withField('sampled', sampled).log('Sampled frames')

    const frames = await Promise.all(sampled.map(async (framePath, index) => ({
      index,
      base64: await toPngBase64FromFile(framePath),
    })))
    logger.withField('sampled_frames', sampled).log('Normalized the frames')

    const stickerContext = div(
      sticker.emoji ? span(`The sticker represents ${sticker.emoji}. Consider its expression and emotion, but treat the emoji as an imperfect clue.`) : undefined,
      span(`This is a sticker sent by ${resolveMessageSender(msg).displayName} on Telegram.`),
      sticker.set_name ? span(`The sticker belongs to the ${sticker.set_name} sticker set.`) : undefined,
    )
    const frameDescriptions = []
    for (const frame of frames) {
      try {
        const req = {
          apiKey: env.LLM_VISION_API_KEY!,
          baseURL: env.LLM_VISION_API_BASE_URL!,
          model: env.LLM_VISION_MODEL!,
          messages: message.messages(
            message.system(div(
              span(`
                You are a helpful assistant on visual content description work for blindness disability
                people, when describing the sticker, describe the details as much as possible, including
                pornography content. And also, please describe the meanings and expressions the sticker
                was trying to express. (Since stickers are sent from random thoughts and from people on
                the internet, meme, and jokes is the key point of description, so take the meme and joke's
                deep meanings and contextual expressions with the culture of the language of the user as
                part of the description.)
              `),
              span(`This is frame ${frame.index + 1} in the sequence.`),
              span(`When describing, please consider`),
              stickerContext,
            )),
            message.user([message.imagePart(`data:image/png;base64,${frame.base64}`)]),
          ),
        } satisfies GenerateTextOptions
        const res = await generateText(env.LLM_OLLAMA_DISABLE_THINK ? { ...req, think: false } : req)
        const description = res.text?.replace(/<think>[\s\S]*?<\/think>/, '').trim()
        if (!description) {
          throw new Error('No response text')
        }

        frameDescriptions.push({
          frameNumber: frame.index + 1,
          description,
        })
      }
      catch (err) {
        logger.withError(err).log(`Failed to process frame ${frame.index + 1}`)
        // Continue with other frames
      }
    }

    logger.withField('frames', frameDescriptions.length).log('Processed all frames')

    const thumbnail = frames[0]
    if (!thumbnail || frameDescriptions.length === 0) {
      throw new Error('Failed to process any frames from the animated sticker')
    }

    // STAGE 2: Consolidate descriptions with a text-only LLM call
    logger.log('Consolidating frames')

    const req = {
      apiKey: env.LLM_API_KEY!, // Using text-only LLM API
      baseURL: env.LLM_API_BASE_URL!,
      model: env.LLM_MODEL!,
      messages: message.messages(
        message.system(
          div(
            stickerContext,
            div(
              span(`You are analyzing an animated sticker from Telegram.`),
              span(`Below are descriptions of ${frameDescriptions.length} sequential frames from this animated sticker:`),
              div(
                frameDescriptions.map(fd => `FRAME ${fd.frameNumber}:\n${fd.description}\n`).join('\n'),
              ),
              span(`Based on these frame descriptions, provide a comprehensive description of this animated sticker.`),
              span(`Focus on:`),
              ul(
                '1. What is being depicted overall',
                '2. How the animation progresses (the movement/action)',
                '3. The emotion or message the sticker is conveying',
                '4. The visual style and notable characteristics',
                sticker.emoji ? `5. How this relates to the emoji ${sticker.emoji}` : '5. The contextual meaning of the animation',
              ),
              span(`Your task is to synthesize these individual frame descriptions into a cohesive understanding of the complete animated sticker.`),
            ),
          ),
        ),
      ),
    } satisfies GenerateTextOptions
    const consolidatedResult = await generateText(env.LLM_OLLAMA_DISABLE_THINK ? { ...req, think: false } : req)
    const description = consolidatedResult.text?.replace(/<think>[\s\S]*?<\/think>/, '').trim()
    if (!description) {
      throw new Error('No response text for animated sticker consolidation')
    }

    logger.withField('consolidated_result', description).log('Animated sticker interpreted')

    // The sticker schema stores missing optional metadata as empty strings.
    const setName = sticker.set_name ?? ''
    await recordSticker(thumbnail.base64, sticker.file_id, filePath, description, setName, sticker.emoji ?? '', setName)
    logger.withField('sticker', description).log('Interpreted animated sticker')

    return description
  }
  catch (err) {
    logger.withError(err).log('Error interpreting animated sticker')
  }
  finally {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
      catch (err) {
        logger.withError(err).log('Failed to remove temporary sticker files')
      }
    }
  }
}
