import { plugin as crossWsPlugin } from 'crossws/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('h3', () => ({
  defineWebSocketHandler: vi.fn(hooks => ({ kind: 'h3-handler', hooks })),
}))

vi.mock('crossws/server', () => ({
  plugin: vi.fn(options => ({ kind: 'crossws-plugin', options })),
}))

describe('better-ws H3 adapter', () => {
  it('converts a better-ws server to an H3 websocket handler', async () => {
    const { createServer } = await import('..')
    const { toH3Handler } = await import('.')

    const server = createServer<string>()
    const handler = toH3Handler(server)

    expect(handler).toMatchObject({
      kind: 'h3-handler',
      hooks: {
        open: expect.any(Function),
        message: expect.any(Function),
      },
    })
  })

  it('creates the CrossWS plugin resolver used by H3 serve', async () => {
    const { createH3CrossWsPlugin } = await import('.')
    const app = {
      fetch: vi.fn(async () => Object.assign(new Response(null), {
        crossws: { open: vi.fn() },
      })),
    }

    const plugin = createH3CrossWsPlugin(app)
    const options = vi.mocked(crossWsPlugin).mock.lastCall?.[0]
    if (!options?.resolve) {
      throw new Error('Expected a CrossWS plugin resolver.')
    }
    const resolved = await options.resolve(new Request('http://localhost/ws'))

    expect(plugin).toMatchObject({ kind: 'crossws-plugin' })
    expect(app.fetch).toHaveBeenCalledOnce()
    expect(resolved).toEqual({ open: expect.any(Function) })
  })
})
