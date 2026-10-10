import type { ClientOptions } from '@proj-airi/server-sdk'
import type { WebSocketEvents } from '@proj-airi/server-shared/types'

import { Client as ServerChannel } from '@proj-airi/server-sdk'
import { ChannelManager, Client } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscordAdapter } from './airi-adapter'

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }))

vi.mock('@huggingface/transformers', () => ({ pipeline: vi.fn() }))
vi.mock('@proj-airi/server-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/server-sdk')>()
  return {
    ...actual,
    Client: class extends actual.Client {
      constructor(options: ClientOptions) {
        super({ ...options, autoConnect: false })
      }
    },
  }
})
vi.mock('@guiiai/logg', () => {
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: logError,
    withError() { return this },
    withField() { return this },
    withFields() { return this },
    useGlobalConfig() { return this },
  }
  return { useLogg: () => logger }
})

let adapter: DiscordAdapter

beforeEach(() => {
  logError.mockClear()
  vi.spyOn(Client.prototype, 'isReady').mockReturnValue(false)
  vi.spyOn(Client.prototype, 'login').mockResolvedValue('token')
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  vi.spyOn(ServerChannel.prototype, 'onEvent')
  adapter = new DiscordAdapter({ discordToken: 'token' })
})

afterEach(async () => {
  await adapter.stop()
  vi.restoreAllMocks()
})

async function configure(config: WebSocketEvents['module:configure']['config']) {
  const handler = vi.mocked(ServerChannel.prototype.onEvent).mock.calls.find(([event]) => event === 'module:configure')?.[1]
  if (!handler)
    throw new Error('Missing configuration handler')

  await handler({
    type: 'module:configure',
    data: { moduleName: 'discord', config },
    metadata: { source: { id: 'test' }, event: { id: 'config-event' } },
  })
}

describe('discord configuration', () => {
  it('connects an unready client even when its token is unchanged', async () => {
    await configure({ enabled: true, token: 'token' })

    expect(Client.prototype.isReady).toHaveBeenCalled()
    expect(Client.prototype.login).toHaveBeenCalledExactlyOnceWith('token')
    expect(Client.prototype.destroy).not.toHaveBeenCalled()
  })

  it('keeps a ready client when its token is unchanged', async () => {
    vi.mocked(Client.prototype.isReady).mockReturnValue(true)

    await configure({ enabled: true, token: 'token' })

    expect(Client.prototype.login).not.toHaveBeenCalled()
    expect(Client.prototype.destroy).not.toHaveBeenCalled()
  })

  it('reconnects a ready client after a token change', async () => {
    vi.mocked(Client.prototype.isReady).mockReturnValue(true)

    await configure({ enabled: true, token: 'replacement' })

    expect(Client.prototype.destroy).toHaveBeenCalledOnce()
    expect(Client.prototype.login).toHaveBeenCalledExactlyOnceWith('replacement')
  })

  it.each([{ enabled: false }, { enabled: true }])('leaves an unready client alone for %j', async (config) => {
    await configure(config)

    expect(Client.prototype.destroy).not.toHaveBeenCalled()
    expect(Client.prototype.login).not.toHaveBeenCalled()
  })

  it.each([{ enabled: false }, { enabled: true }])('stops a ready client for %j', async (config) => {
    vi.mocked(Client.prototype.isReady).mockReturnValue(true)

    await configure(config)

    expect(Client.prototype.destroy).toHaveBeenCalledOnce()
    expect(Client.prototype.login).not.toHaveBeenCalled()
  })

  it('permits a later configuration after a failed login', async () => {
    vi.mocked(Client.prototype.login).mockRejectedValueOnce(new Error('Login failed'))

    await configure({ enabled: true, token: 'token' })
    await configure({ enabled: true, token: 'token' })

    expect(Client.prototype.login).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledExactlyOnceWith('Failed to apply Discord configuration.')
  })
})

describe('generated chat messages', () => {
  it.each([
    { message: { role: 'assistant', content: 'Hello' } },
    {
      'message': { role: 'assistant', content: 'Hello' },
      'gen-ai:chat': {
        message: { role: 'user', content: 'Hi' },
        contexts: {},
        composedMessage: [],
      },
    },
  ] satisfies WebSocketEvents['output:gen-ai:chat:message'][])('ignores output with no Discord input metadata', async (data) => {
    const fetchChannel = vi.spyOn(ChannelManager.prototype, 'fetch')
    const handler = vi.mocked(ServerChannel.prototype.onEvent).mock.calls.find(([event]) => event === 'output:gen-ai:chat:message')?.[1]
    if (!handler)
      throw new Error('Missing output handler')

    await handler({
      type: 'output:gen-ai:chat:message',
      data,
      metadata: { source: { id: 'test' }, event: { id: 'output-event' } },
    })

    expect(fetchChannel).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })
})
