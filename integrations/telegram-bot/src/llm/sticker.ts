import type { GenerateTextOptions } from '@xsai/generate-text'
import type { Bot } from 'grammy'
import type { Message, Sticker } from 'grammy/types'

import { env } from 'node:process'

import { useLogg } from '@guiiai/logg'
import { embed } from '@xsai/embed'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'

import { resolveMessageSender } from '../models/common'
import { findStickerDescription, recordSticker } from '../models/stickers'
import { div, span } from '../prompts/utils'
import { interpretAnimatedSticker } from './animated-sticker'
import { toPngBase64 } from './image'

/** Describes uncached stickers and stores only nonempty model text. */
export async function interpretSticker(bot: Bot, msg: Message, sticker: Sticker) {
  const logger = useLogg('interpretSticker').useGlobalConfig()

  if (sticker.is_animated || sticker.is_video) {
    logger
      .withField('sticker_emoji', sticker.emoji)
      .withField('sticker_set', sticker.set_name)
      .withField('is_animated', sticker.is_animated)
      .withField('is_video', sticker.is_video)
      .log('Animated or video sticker, interpreting as animated sticker')

    return interpretAnimatedSticker(bot, msg, sticker)
  }

  try {
    if (await findStickerDescription(sticker.file_id)) {
      logger.withField('sticker', sticker).log('Sticker already interpreted, skipping')
      return
    }

    const file = await bot.api.getFile(sticker.file_id)
    const filePath = file.file_path
    if (!filePath) {
      throw new Error(`Telegram returned no file path for sticker ${sticker.file_id}`)
    }

    const stickerRes = await fetch(`https://api.telegram.org/file/bot${bot.api.token}/${filePath}`)
    const buffer = await stickerRes.arrayBuffer()
    const stickerBase64 = await toPngBase64(buffer)

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
          div(
            span(`When describing, please consider`),
            sticker.emoji ? span(`The sticker represents ${sticker.emoji}. Consider its expression and emotion, but treat the emoji as an imperfect clue.`) : undefined,
            span(`This is a sticker sent by ${resolveMessageSender(msg).displayName} on Telegram.`),
            sticker.set_name ? span(`The sticker belongs to the ${sticker.set_name} sticker set.`) : undefined,
          ),
        )),
        message.user([message.imagePart(`data:image/png;base64,${stickerBase64}`)]),
      ),
    } satisfies GenerateTextOptions
    const res = await generateText(env.LLM_OLLAMA_DISABLE_THINK ? { ...req, think: false } : req)
    const description = res.text?.replace(/<think>[\s\S]*?<\/think>/, '').trim()
    if (!description) {
      throw new Error('No response text')
    }

    // TODO: implement this for sticker searching
    const _embedRes = await embed({
      baseURL: env.EMBEDDING_API_BASE_URL!,
      apiKey: env.EMBEDDING_API_KEY!,
      model: env.EMBEDDING_MODEL!,
      input: 'Hello, world!',
    })

    // The sticker schema stores missing optional metadata as empty strings.
    const setName = sticker.set_name ?? ''
    await recordSticker(stickerBase64, sticker.file_id, filePath, description, setName, sticker.emoji ?? '', setName)
    logger.withField('sticker', description).log('Interpreted sticker')
  }
  catch (err) {
    logger.withError(err).log('Error occurred')
  }
}
