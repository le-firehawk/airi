import { Buffer } from 'node:buffer'
import { once } from 'node:events'

import OpusScript from 'opusscript'

import { createAudioPlayer, getGroups, VoiceConnection } from '@discordjs/voice'
import { Client as AiriClient } from '@proj-airi/server-sdk'
import { ChannelType, Client, ClientUser, Collection } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceManager } from './summon'

vi.mock('@huggingface/transformers', () => ({ pipeline: vi.fn() }))

class BotUser extends ClientUser {
  constructor(client: Client<true>) {
    super(client, { id: '100000000000000001', username: 'AIRI', bot: true })
  }
}

const clients: Client[] = []
const airiClients: AiriClient[] = []
const connections: VoiceConnection[] = []
const fetchTranscription = vi.fn<typeof fetch>()

async function createVoiceFixture(nickname: string | null = null) {
  const client = new Client<true>({ intents: [] })
  client.user = new BotUser(client)
  clients.push(client)
  const rest = vi.spyOn(client.rest, 'get')
  rest.mockResolvedValueOnce({ id: '100000000000000002', name: 'Test guild', features: [] })
  const guild = await client.guilds.fetch('100000000000000002')
  rest.mockResolvedValueOnce({
    user: { id: '100000000000000003', username: 'Speaker', discriminator: '0', avatar: null, bot: false },
    nick: nickname,
    roles: [],
    joined_at: '2026-01-01T00:00:00.000Z',
    deaf: false,
    mute: false,
    flags: 0,
  })
  const member = await guild.members.fetch('100000000000000003')
  rest.mockResolvedValueOnce({
    id: '100000000000000004',
    guild_id: guild.id,
    name: 'Voice',
    type: ChannelType.GuildVoice,
    bitrate: 64000,
    user_limit: 0,
    position: 0,
    permission_overwrites: [],
    parent_id: null,
  })
  const channel = await guild.channels.fetch('100000000000000004')
  if (!channel?.isVoiceBased())
    throw new Error('Expected a voice channel')

  vi.spyOn(channel, 'members', 'get').mockReturnValue(new Collection([[member.id, member]]))
  const airi = new AiriClient({ name: 'discord-test', autoConnect: false })
  airiClients.push(airi)
  const send = vi.spyOn(airi, 'send').mockReturnValue(true)
  const manager = new VoiceManager(client, airi)
  const connection = new VoiceConnection({
    channelId: channel.id,
    guildId: guild.id,
    group: client.user.id,
    selfDeaf: false,
    selfMute: false,
  }, {
    adapterCreator: () => ({ sendPayload: () => true, destroy: vi.fn() }),
  })
  connections.push(connection)
  getGroups().set(client.user.id, new Map([[guild.id, connection]]))

  return { client, guild, member, channel, manager, connection, send }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchTranscription)
  vi.stubEnv('OPENAI_STT_API_KEY', 'test-key')
  vi.stubEnv('OPENAI_STT_MODEL', 'whisper-1')
  vi.stubEnv('OPENAI_STT_API_BASE_URL', 'https://speech.example/v1/')
  fetchTranscription.mockReset()
  fetchTranscription.mockImplementation(async () => Response.json({ text: 'Hello from voice' }))
})

afterEach(async () => {
  for (const connection of connections.splice(0)) {
    getGroups().delete(connection.joinConfig.group)
    connection.destroy()
  }
  for (const client of clients.splice(0)) {
    if (client.user)
      getGroups().delete(client.user.id)
    await client.destroy()
  }
  for (const airi of airiClients.splice(0))
    airi.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('voice receive lifecycle', () => {
  it('ignores a speaking-end event after the member leaves the channel', async () => {
    const { manager, channel } = await createVoiceFixture()

    await expect(Promise.resolve().then(() => manager.handleAudioReceiveStreamEnd(channel)('departed-member'))).resolves.toBeUndefined()
  })

  it('does not subscribe when the client is logged out', async () => {
    const { client, member, channel, manager, connection } = await createVoiceFixture()
    const loggedOutClient: Client = client
    loggedOutClient.user = null

    await manager.handleAudioReceiveStreamStart(channel)(member.id)

    expect(connection.receiver.subscriptions.size).toBe(0)
  })

  it.each([null, 'Guild nickname'])('sends plain member metadata after successful audio completion (%s)', async (nickname) => {
    const { member, channel, manager, connection, send } = await createVoiceFixture(nickname)
    const cleanup = vi.spyOn(manager, 'cleanupAudioPlayer')
    await manager.handleAudioReceiveStreamStart(channel)(member.id)
    const receiveStream = connection.receiver.subscriptions.get(member.id)
    if (!receiveStream)
      throw new Error('Expected a member audio subscription')

    const encoder = new OpusScript(16000, 1, OpusScript.Application.VOIP)
    try {
      const packet = encoder.encode(Buffer.alloc(320 * 2), 320)
      const closed = once(receiveStream, 'close')
      receiveStream.push(packet)
      receiveStream.push(null)
      await closed
      await vi.advanceTimersByTimeAsync(1500)
    }
    finally {
      encoder.delete()
    }

    expect(fetchTranscription).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, {
      type: 'input:text:voice',
      data: {
        transcription: 'Hello from voice',
        discord: {
          channelId: channel.id,
          guildId: member.guild.id,
          guildMember: {
            id: member.id,
            displayName: member.displayName,
            nickname: nickname ?? member.displayName,
          },
        },
      },
    })
    expect(send).toHaveBeenNthCalledWith(2, {
      type: 'input:text',
      data: {
        text: 'Hello from voice',
        discord: {
          channelId: channel.id,
          guildId: member.guild.id,
          guildMember: {
            id: member.id,
            displayName: member.displayName,
            nickname: nickname ?? member.displayName,
          },
        },
      },
    })
    expect(cleanup).toHaveBeenCalledWith(null)
  })

  it('cleans up an existing player and accepts no active player', async () => {
    const { manager } = await createVoiceFixture()
    const player = createAudioPlayer()
    const stop = vi.spyOn(player, 'stop')
    player.on('error', vi.fn())

    manager.cleanupAudioPlayer(player)
    manager.cleanupAudioPlayer(null)

    expect(stop).toHaveBeenCalledOnce()
    expect(player.listenerCount('error')).toBe(0)
  })
})
