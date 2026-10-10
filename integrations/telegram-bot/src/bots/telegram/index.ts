import type { Logg } from '@guiiai/logg'
import type { Message } from 'grammy/types'

import type { Action, BotContext, ChatContext } from '../../types'

import { env } from 'node:process'

import { useLogg } from '@guiiai/logg'
import { message } from '@xsai/utils-chat'
import { delay } from 'es-toolkit'
import { Bot } from 'grammy'

import { imagineAnAction } from '../../llm/actions'
import { interpretPhotos } from '../../llm/photo'
import { interpretSticker } from '../../llm/sticker'
import { findStickerByFileId, findStickersByFileIds, recordMessage } from '../../models'
import { listJoinedChats, recordJoinedChat } from '../../models/chats'
import { resolveMessageSender } from '../../models/common'
import { listStickerPacks, recordStickerPack } from '../../models/sticker-packs'
import { withTelegramAbortSignal } from '../../utils/telegram'
import { readMessage } from './agent/actions/read-message'
import { sendMessage } from './agent/actions/send-message'
// import { shouldInterruptProcessing } from './agent/interruption'

// Each continuation belongs to one chat. A new message aborts that chat's active step.
type LoopStep = () => Promise<LoopStep | undefined>

async function dispatchAction(ctx: BotContext, action: Action | undefined, abortController: AbortController, chatCtx?: ChatContext): Promise<LoopStep | undefined> {
  abortController.signal.throwIfAborted()

  // If action generation failed, don't proceed with further processing
  if (!action || !action.action) {
    ctx.logger.withField('action', action).log('No valid action returned.')
    if (chatCtx) {
      chatCtx.messages.push(message.user('AIRI System: No valid action returned.'))
      return () => handleLoopStep(ctx, chatCtx)
    }
    else {
      return
    }
  }

  switch (action.action) {
    case 'list_stickers':
    {
      if (chatCtx) {
        await ctx.bot.api.sendChatAction(chatCtx.chatId, 'choose_sticker')
      }

      const stickerPacks = await listStickerPacks()
      const stickerSets = await Promise.all(stickerPacks.map(s => ctx.bot.api.getStickerSet(s.platform_id)))
      const stickersIds = stickerSets.flatMap(s => s.stickers.map(sticker => sticker.file_id))
      const stickerDescriptions = await findStickersByFileIds(stickersIds)
      const stickerDescriptionsOneliner = stickerDescriptions.map(d => `Sticker File ID: ${d.file_id}, Description: ${d.description}`)

      if (chatCtx) {
        if (stickerDescriptionsOneliner.length === 0) {
          chatCtx.actions.push({ action, result: 'AIRI System: No stickers found in the current memory partition, preload of stickers is required, please ask for help.' })
        }
        else {
          chatCtx.actions.push({ action, result: `AIRI System: List of stickers:\n${stickerDescriptionsOneliner}` })
        }
      }

      return
    }
    case 'send_sticker':
    {
      const chatCtx = ensureChatContext(ctx, action.chatId)

      try {
        const file = await withTelegramAbortSignal(abortController.signal, signal => ctx.bot.api.getFile(action.fileId, signal))
        if (!file) {
          chatCtx.actions.push({ action, result: `AIRI System: Error executing 'send_sticker': Sticker file ID ${action.fileId} not found, did you list the needed stickers before sending?` })
          return () => handleLoopStep(ctx, chatCtx)
        }
      }
      catch (err) {
        abortController.signal.throwIfAborted()
        chatCtx.actions.push({ action, result: `AIRI System: Error executing 'send_sticker': Sticker file ID ${action.fileId} not found or failed due to ${String(err)}, did you list the needed stickers before sending?` })
        return () => handleLoopStep(ctx, chatCtx)
      }

      const sticker = await findStickerByFileId(action.fileId)
      const stickerDescription = sticker ? ` with (${sticker.emoji} in set ${sticker.name})` : ''
      chatCtx.actions.push({ action, result: `AIRI System: Sending sticker ${action.fileId}${stickerDescription} to ${action.chatId}` })
      abortController.signal.throwIfAborted()
      await withTelegramAbortSignal(abortController.signal, signal => ctx.bot.api.sendSticker(action.chatId, action.fileId, undefined, signal))
      // A late accepted delivery cannot restart an interrupted chat loop.
      abortController.signal.throwIfAborted()

      return () => handleLoopStep(ctx, chatCtx)
    }
    case 'read_unread_messages':
    {
      const chatCtx = ensureChatContext(ctx, action.chatId)

      if (Object.keys(ctx.unreadMessages).length === 0) {
        ctx.logger.withField('action', action).log('No unread messages - deleting all unread messages')
        ctx.unreadMessages = {}
        break
      }
      if (action.chatId == null) {
        ctx.logger.withField('action', action).warn('No group ID - deleting all unread messages')
        break
      }

      const unreadMessagesForThisChat = ctx.unreadMessages[action.chatId]
      if (!unreadMessagesForThisChat?.length) {
        ctx.logger.withField('action', action).log('No unread messages for chat')
        delete ctx.unreadMessages[action.chatId]
        break
      }

      const mentionedBy = unreadMessagesForThisChat.find(msg => msg.text?.includes(ctx.bot.botInfo.username) || msg.text?.includes(ctx.bot.botInfo.first_name))
      if (mentionedBy) {
        chatCtx.messages.push(message.user(`AIRI System: You were mentioned in a message: ${mentionedBy.text} by ${resolveMessageSender(mentionedBy).displayName}, please respond as much as possible.`))
      }

      // // Add attention check before processing action
      // // eslint-disable-next-line no-case-declarations
      // const shouldRespond = await state.attentionHandler.shouldRespond(forGroupId, unreadMessagesForThisChat)

      // if (!shouldRespond.shouldAct) {
      //   state.logger.withField('reason', shouldRespond.reason).withField('responseRate', shouldRespond.responseRate).log('Skipping message due to attention check')
      //   state.unreadMessages[action.groupId] = unreadMessagesForThisChat.shift()
      //   return { break: true }
      // }

      const res = await readMessage(ctx, ctx.bot.botInfo.id.toString(), chatCtx.chatId, action, unreadMessagesForThisChat, abortController)
      if (res?.result) {
        ctx.logger.log('message, read')
        chatCtx.actions.push({ action, result: res.result })
        return () => handleLoopStep(ctx, chatCtx)
      }
      else {
        return
      }
    }
    case 'list_chats':
      if (chatCtx) {
        chatCtx.actions.push({ action, result: `AIRI System: List of chats:${(await listJoinedChats()).map(chat => `ID:${chat.chat_id}, Name:${chat.chat_name}`).join('\n')}` })
      }

      return
    case 'send_message':
    {
      const chatCtx = ensureChatContext(ctx, action.chatId)
      chatCtx.actions.push({ action, result: `AIRI System: Sending message to group ${action.chatId}: ${action.content}` })
      await sendMessage(ctx, chatCtx, action.content, action.chatId, abortController)
      return () => handleLoopStep(ctx, chatCtx)
    }
    case 'continue':
      if (chatCtx) {
        chatCtx.actions.push({ action, result: 'AIRI System: Acknowledged, will now continue until next tick.' })
      }

      return
    case 'break':
      if (chatCtx) {
        chatCtx.messages = []
        chatCtx.actions = []
        chatCtx.actions.push({ action, result: 'AIRI System: Acknowledged, will now break, and clear out all existing memories, messages, actions. Left only this one.' })
      }

      return
    case 'sleep':
      await delay(30 * 1000, { signal: abortController.signal })
      if (chatCtx) {
        chatCtx.actions.push({ action, result: `AIRI System: Sleeping for ${30} seconds as requested...` })
        return () => handleLoopStep(ctx, chatCtx)
      }

      return
    default:
      if (chatCtx) {
        chatCtx.messages.push(message.user(`AIRI System: The action you sent ${action.action} haven't implemented yet by developer.`))
      }
  }
}

async function handleLoopStep(ctx: BotContext, chatCtx: ChatContext, incomingMessage?: Message): Promise<LoopStep | undefined> {
  ctx.currentProcessingStartTime = Date.now()

  if (chatCtx?.currentAbortController) {
    chatCtx.currentAbortController.abort()
  }

  const currentController = new AbortController()
  if (chatCtx) {
    chatCtx.currentAbortController = currentController

    // Track message processing state
    if (chatCtx.chatId && !ctx.lastInteractedNChatIds.includes(chatCtx.chatId)) {
      ctx.lastInteractedNChatIds.push(chatCtx.chatId)
    }
    if (ctx.lastInteractedNChatIds.length > 5) {
      ctx.lastInteractedNChatIds = ctx.lastInteractedNChatIds.slice(-5)
    }

    chatCtx.messages ??= []
    if (chatCtx.messages.length > 20) {
      const length = chatCtx.messages.length
      // pick the latest 5
      chatCtx.messages = chatCtx.messages.slice(-5)
      chatCtx.messages.push(message.user(`AIRI System: Approaching to system context limit, reducing... memory..., reduced from ${length} to ${chatCtx.messages.length}, history may lost.`))
    }

    chatCtx.actions ??= []
    if (chatCtx.actions.length > 50) {
      const length = chatCtx.actions.length
      // pick the latest 20
      chatCtx.actions = chatCtx.actions.slice(-20)
      chatCtx.messages.push(message.user(`AIRI System: Approaching to system context limit, reducing... memory..., reduced from ${length} to ${chatCtx.actions.length}, history of actions may lost.`))
    }
  }

  try {
    const readUnreadMessagesActions: { index: number, actionState: typeof chatCtx.actions[number] }[] = []

    if (chatCtx) {
      for (const actionHistory of chatCtx.actions) {
        if (actionHistory.action.action === 'read_unread_messages') {
          readUnreadMessagesActions.push({ index: chatCtx.actions.indexOf(actionHistory), actionState: actionHistory })
        }
      }
    }

    readUnreadMessagesActions.map((item, index) => {
      if (index === readUnreadMessagesActions.length - 1) {
        return item
      }

      item.actionState.result = 'AIRI System: Please refer to the last read_unread_messages action for context.'
      return item
    })

    if (chatCtx) {
      for (const item of readUnreadMessagesActions) {
        chatCtx.actions[item.index] = item.actionState
      }
    }

    const action = await imagineAnAction(ctx.bot.botInfo.id.toString(), currentController, chatCtx.messages, chatCtx.actions, { unreadMessages: ctx.unreadMessages, incomingMessages: incomingMessage ? [incomingMessage] : undefined })
    return await dispatchAction(ctx, action, currentController, chatCtx)
  }
  catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      ctx.logger.log('Operation was aborted due to interruption')
      return
    }

    ctx.logger.withError(err).log('Error occurred')
  }
  finally {
    // Clean up timing when done
    if (chatCtx && chatCtx.currentAbortController === currentController) {
      chatCtx.currentAbortController = undefined
      ctx.currentProcessingStartTime = undefined
    }
  }
}

async function isChatIdBotAdmin(fromId: number) {
  if (!env.ADMIN_USER_IDS) {
    return false
  }

  const admins = env.ADMIN_USER_IDS.split(',')
  if (admins.length === 0) {
    return false
  }

  return admins.includes(fromId.toString())
}

async function loopIterationForChat(bot: BotContext, chatContext: ChatContext, incomingMessage: Message) {
  let result = await handleLoopStep(bot, chatContext, incomingMessage)

  while (typeof result === 'function') {
    result = await result()
  }

  return result
}

async function loopIterationPeriodicForExistingChat(ctx: BotContext) {
  for (const [chatId] of ctx.chats) {
    const chatCtx = ensureChatContext(ctx, chatId)

    let result = await handleLoopStep(ctx, chatCtx)

    while (typeof result === 'function') {
      result = await result()
    }
  }
}

async function loopIterationPeriodicWithNoChats(ctx: BotContext) {
  const abortController = new AbortController()
  const action = await imagineAnAction(ctx.bot.botInfo.id.toString(), abortController, [], [], { unreadMessages: ctx.unreadMessages })
  let result = await dispatchAction(ctx, action, abortController)

  while (typeof result === 'function') {
    result = await result()
  }
}

function loopPeriodic(botCtx: BotContext) {
  setTimeout(async () => {
    try {
      await loopIterationPeriodicForExistingChat(botCtx)
      await loopIterationPeriodicWithNoChats(botCtx)
    }
    catch (err) {
      if (err instanceof Error && err.name === 'AbortError')
        botCtx.logger.log('main loop was aborted - restarting loop')
      else
        botCtx.logger.withError(err).log('error in main loop')
    }
    finally {
      loopPeriodic(botCtx)
    }
  }, 60 * 1000)
}

function createBotContext(telegramBot: Bot, logger: Logg): BotContext {
  const botSelf: BotContext = {
    bot: telegramBot,
    messageQueue: [],
    unreadMessages: {},
    processedIds: new Set(),
    logger,
    processing: false,
    lastInteractedNChatIds: [],
    chats: new Map<string, ChatContext>(),
  }

  return botSelf
}

async function onMessageArrival(botContext: BotContext) {
  if (botContext.processing)
    return
  botContext.processing = true

  try {
    while (botContext.messageQueue.length > 0) {
      const nextMsg = botContext.messageQueue[0]

      // Don't process next messages until current one is ready
      if (nextMsg.status === 'pending') {
        if (nextMsg.message.sticker) {
          nextMsg.status = 'interpreting'
          await interpretSticker(botContext.bot, nextMsg.message, nextMsg.message.sticker)
          nextMsg.status = 'ready'
        }
        else if (nextMsg.message.photo) {
          nextMsg.status = 'interpreting'
          await interpretPhotos(botContext, nextMsg.message, nextMsg.message.photo)
          nextMsg.status = 'ready'
        }
        else {
          nextMsg.status = 'ready'
        }
      }

      if (nextMsg.status === 'ready') {
        switch (nextMsg.message.chat.type) {
          case 'private':
            await recordJoinedChat(nextMsg.message.chat.id.toString(), [nextMsg.message.chat.first_name, nextMsg.message.chat.last_name].filter(Boolean).join(' '))
            break
          case 'channel':
          case 'group':
          case 'supergroup':
            await recordJoinedChat(nextMsg.message.chat.id.toString(), nextMsg.message.chat.title)
            break
        }

        await recordMessage(botContext.bot.botInfo, nextMsg.message)

        let unreadMessagesForThisChat = botContext.unreadMessages[nextMsg.message.chat.id.toString()]

        if (unreadMessagesForThisChat == null) {
          botContext.logger.withField('chatId', nextMsg.message.chat.id).log('unread messages for this chat is null - creating empty array')
          unreadMessagesForThisChat = []
        }
        if (!Array.isArray(unreadMessagesForThisChat)) {
          botContext.logger.withField('chatId', nextMsg.message.chat.id).log('unread messages for this chat is not an array - converting to array')
          unreadMessagesForThisChat = []
        }

        unreadMessagesForThisChat.push(nextMsg.message)

        if (unreadMessagesForThisChat.length > 100) {
          unreadMessagesForThisChat = unreadMessagesForThisChat.slice(-100)
        }

        botContext.unreadMessages[nextMsg.message.chat.id.toString()] = unreadMessagesForThisChat
        botContext.logger.withField('chatId', nextMsg.message.chat.id).log('message queue processed, triggering immediate reaction')
        // Trigger immediate processing when messages are ready
        const chatCtx = ensureChatContext(botContext, nextMsg.message.chat.id.toString())
        void loopIterationForChat(botContext, chatCtx, nextMsg.message).catch(err => botContext.logger.withError(err).log('Chat loop failed'))
        botContext.messageQueue.shift()
      }
    }
  }
  catch (err) {
    botContext.logger.withError(err).log('Error occurred')
  }
  finally {
    botContext.processing = false
  }
}

function ensureChatContext(botCtx: BotContext, chatId: string): ChatContext {
  const existingContext = botCtx.chats.get(chatId)
  if (existingContext) {
    return existingContext
  }

  const newChatContext: ChatContext = {
    chatId,
    currentTask: undefined,
    currentAbortController: undefined,
    messages: [],
    actions: [],
  }

  botCtx.chats.set(chatId, newChatContext)
  return newChatContext
}

export async function startTelegramBot() {
  const log = useLogg('Bot').useGlobalConfig()

  const telegramBot = new Bot(env.TELEGRAM_BOT_TOKEN!)
  telegramBot.errorHandler = async err => log.withError(err).log('Error occurred')

  const botCtx = createBotContext(telegramBot, log)

  telegramBot.command('add_sticker_pack', async (ctx) => {
    const commandMessage = ctx.msg
    const sender = ctx.from
    if (!commandMessage || !sender || commandMessage.sender_chat || !(await isChatIdBotAdmin(sender.id))) {
      log.withField('from_id', sender?.id).log('not an admin - skipping')
      return
    }
    if (commandMessage.reply_to_message == null) {
      await ctx.reply('Please reply to a sticker pack to add it.')
      return
    }

    const logger = useLogg('addStickerPack').useGlobalConfig()

    const repliedSticker = commandMessage.reply_to_message.sticker
    if (!repliedSticker?.set_name) {
      await ctx.reply('Please reply to a sticker from a sticker pack.')
      return
    }
    const stickerSet = await telegramBot.api.getStickerSet(repliedSticker.set_name)

    logger.withField('sticker_set', repliedSticker.set_name).log('now will register the sticker set as known sticker set')

    for (const sticker of stickerSet.stickers) {
      logger.withField('sticker', sticker).log('interpreting sticker')
      await interpretSticker(botCtx.bot, commandMessage.reply_to_message, sticker)
      logger.withField('sticker', sticker).log('interpreted sticker')
    }

    await recordStickerPack(repliedSticker.set_name, stickerSet.name)
    await ctx.reply('Sticker pack added.')
  })

  telegramBot.on(['message:sticker', 'channel_post:sticker', 'message:photo', 'channel_post:photo', 'message:text', 'channel_post:text'], async (ctx) => {
    const incomingMessage = ctx.msg
    const messageId = `${incomingMessage.chat.id}-${incomingMessage.message_id}`
    if (!botCtx.processedIds.has(messageId)) {
      botCtx.processedIds.add(messageId)
      botCtx.messageQueue.push({
        message: incomingMessage,
        status: incomingMessage.sticker || incomingMessage.photo ? 'pending' : 'ready',
      })
    }

    await onMessageArrival(botCtx)
  })

  await telegramBot.init()
  log.withField('bot_username', telegramBot.botInfo.username).log('bot initialized')
  telegramBot.start({ drop_pending_updates: true })

  try {
    loopPeriodic(botCtx)
  }
  catch (err) {
    console.error(err)
  }
}
