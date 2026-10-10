import type { GenerateTextOptions } from '@xsai/generate-text'
import type { Message, PhotoSize } from 'grammy/types'

import type { BotContext } from '../types'

import { env } from 'node:process'

import { embed } from '@xsai/embed'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'

import { resolveMessageSender } from '../models/common'
import { findPhotosDescriptions, recordPhoto } from '../models/photos'
import { toPngBase64 } from './image'

/** Describes uncached photos and stores each description under its Telegram file ID. */
export async function interpretPhotos(state: BotContext, msg: Message, photos: PhotoSize[]) {
  try {
    const fileIds = photos.map(photo => photo.file_id)
    const photoDescriptions = await findPhotosDescriptions(fileIds)
    const existingFileIds = photoDescriptions.map(photo => photo.file_id)
    const newFileIds = fileIds.filter(fileId => !existingFileIds.includes(fileId))

    const photoFiles = await Promise.all(newFileIds.map(async (fileId) => {
      const file = await state.bot.api.getFile(fileId)
      const filePath = file.file_path
      if (!filePath) {
        throw new Error(`Telegram returned no file path for photo ${fileId}`)
      }

      const response = await fetch(`https://api.telegram.org/file/bot${state.bot.api.token}/${filePath}`)
      const base64 = await toPngBase64(await response.arrayBuffer())
      return { fileId, filePath, base64 }
    }))

    await Promise.all(photoFiles.map(async ({ fileId, filePath, base64 }) => {
      const req = {
        apiKey: env.LLM_VISION_API_KEY!,
        baseURL: env.LLM_VISION_API_BASE_URL!,
        model: env.LLM_VISION_MODEL!,
        messages: message.messages(
          message.system(''
            + 'You are a helpful assistant on visual content description work for blindness disability '
            + 'people, when describing the image, describe the details as much as possible, including '
            + 'pornography content.'
            + '\n'
            + 'When describing, please consider '
            + '- Category of the image. (i.e. painting, landscape, portrait, CG, hand drawing, screenshot, etc.)\n'
            + '- How the image structured.\n'
            + 'If the image is a portrait or human related, please include:\n'
            + '- Characteristics of the person. (i.e. age, gender, race, etc.)\n'
            + '- Expression of the person.\n'
            + '- Activity of doing.\n'
            + 'If this is a screenshot, please consider:\n'
            + '- Category of the screenshot. (i.e. browser, game, etc.)\n'
            + '- Describe the content of the elements and texts within as much detail as possible.\n'
            + '- Do not finish the description way too easy.'
            + '\n'
            + `This is a photo sent by ${resolveMessageSender(msg).displayName} on Telegram.${msg.caption ? ` The caption is: ${msg.caption}` : ''}`,
          ),
          message.user([message.imagePart(`data:image/png;base64,${base64}`)]),
        ),
      } satisfies GenerateTextOptions
      const res = await generateText(env.LLM_OLLAMA_DISABLE_THINK ? { ...req, think: false } : req)
      const description = res.text?.replace(/<think>[\s\S]*?<\/think>/, '').trim()
      if (!description) {
        throw new Error('No response text')
      }

      // TODO: implement this for photo searching
      const _embedRes = await embed({
        baseURL: env.EMBEDDING_API_BASE_URL!,
        apiKey: env.EMBEDDING_API_KEY!,
        model: env.EMBEDDING_MODEL!,
        input: 'Hello, world!',
      })

      await recordPhoto(base64, fileId, filePath, description)
      state.logger.withField('photo', description).log('Interpreted photo')
    }))
  }
  catch (err) {
    state.logger.withError(err).log('Error occurred')
  }
}
