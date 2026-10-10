import { once } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { CdpBridge } from '../browser-dom/cdp-bridge'

const connections = new Set<{ bridge: CdpBridge, server: WebSocketServer }>()

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const { bridge, server } of connections) {
    await bridge.close()
    for (const socket of server.clients)
      socket.terminate()
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
  connections.clear()
})

async function connectHeartbeatBridge(bridge: CdpBridge) {
  const server = new WebSocketServer({ port: 0, autoPong: false })
  connections.add({ bridge, server })
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const request: unknown = JSON.parse(data.toString())
      if (request && typeof request === 'object' && 'id' in request && typeof request.id === 'number')
        socket.send(JSON.stringify({ id: request.id, result: {} }))
    })
  })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Expected a local WebSocket port')

  await bridge.connectToTarget({
    id: 'heartbeat-test',
    type: 'page',
    title: 'Heartbeat test',
    url: 'about:blank',
    webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}`,
  })

  return {
    ping: vi.spyOn(WebSocket.prototype, 'ping'),
    terminate: vi.spyOn(WebSocket.prototype, 'terminate'),
  }
}

describe('cdpBridge', () => {
  it('creates with correct initial status', () => {
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
    })

    const status = bridge.getStatus()
    expect(status.cdpUrl).toBe('http://localhost:9222')
    expect(status.connected).toBe(false)
    expect(status.pageTitle).toBeUndefined()
    expect(status.pageUrl).toBeUndefined()
    expect(status.lastError).toBeUndefined()
  })

  it('formats empty AX tree correctly', () => {
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
    })

    const text = bridge.formatAXTreeAsText({
      nodes: [],
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      capturedAt: '2025-01-01T00:00:00.000Z',
    })

    expect(text).toContain('[Browser AXTree] Example (https://example.com)')
  })

  it('formats AX tree with nodes', () => {
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
    })

    const text = bridge.formatAXTreeAsText({
      nodes: [
        {
          nodeId: '1',
          role: 'RootWebArea',
          name: 'Example Page',
          children: [
            {
              nodeId: '2',
              role: 'heading',
              name: 'Welcome',
              children: [],
            },
            {
              nodeId: '3',
              role: 'textbox',
              name: 'Search',
              value: 'hello world',
              focused: true,
              children: [],
            },
          ],
        },
      ],
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      capturedAt: '2025-01-01T00:00:00.000Z',
    })

    expect(text).toContain('RootWebArea "Example Page"')
    expect(text).toContain('heading "Welcome"')
    expect(text).toContain('textbox "Search" val="hello world" [focused]')
  })

  it('truncates long values in AX tree format', () => {
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
    })

    const longValue = 'A'.repeat(200)
    const text = bridge.formatAXTreeAsText({
      nodes: [
        {
          nodeId: '1',
          role: 'textbox',
          value: longValue,
          children: [],
        },
      ],
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      capturedAt: '2025-01-01T00:00:00.000Z',
    })

    expect(text).toContain('...')
    expect(text).not.toContain('A'.repeat(200))
  })

  it('rejects send when not connected', async () => {
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
    })

    await expect(bridge.send('Runtime.evaluate', {})).rejects.toThrow('CDP bridge is not connected')
  })

  it('close is safe to call when not connected', async () => {
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
    })

    // Should not throw
    await bridge.close()
    expect(bridge.getStatus().connected).toBe(false)
  })

  it('keeps the CDP bridge alive when heartbeat pongs arrive', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
      heartbeatIntervalMs: 10,
      heartbeatFailureLimit: 3,
    })
    const socket = await connectHeartbeatBridge(bridge)
    socket.ping.mockImplementation(function (this: WebSocket) {
      this.emit('pong')
    })

    vi.advanceTimersByTime(40)

    expect(socket.ping).toHaveBeenCalled()
    expect(socket.terminate).not.toHaveBeenCalled()
    expect(bridge.getStatus().connected).toBe(true)
  })

  it('tears down the CDP bridge after consecutive missed heartbeat pongs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
      heartbeatIntervalMs: 10,
      heartbeatFailureLimit: 3,
    })
    const socket = await connectHeartbeatBridge(bridge)

    vi.advanceTimersByTime(30)

    expect(socket.ping).toHaveBeenCalledTimes(3)
    expect(socket.terminate).not.toHaveBeenCalled()
    expect(bridge.getStatus().connected).toBe(true)

    vi.advanceTimersByTime(10)

    expect(socket.terminate).toHaveBeenCalledTimes(1)
    expect(bridge.getStatus().connected).toBe(false)
    expect(bridge.getStatus().lastError).toBe('CDP heartbeat failed after 3 consecutive missed pongs')
  })

  it('does not tear down the CDP bridge before the first heartbeat ping can miss', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
      heartbeatIntervalMs: 10,
      heartbeatFailureLimit: 1,
    })
    const socket = await connectHeartbeatBridge(bridge)

    vi.advanceTimersByTime(10)

    expect(socket.ping).toHaveBeenCalledTimes(1)
    expect(socket.terminate).not.toHaveBeenCalled()
    expect(bridge.getStatus().connected).toBe(true)

    vi.advanceTimersByTime(10)

    expect(socket.ping).toHaveBeenCalledTimes(1)
    expect(socket.terminate).toHaveBeenCalledTimes(1)
    expect(bridge.getStatus().connected).toBe(false)
  })

  it('preserves heartbeat ping errors in the bridge status', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const bridge = new CdpBridge({
      cdpUrl: 'http://localhost:9222',
      requestTimeoutMs: 10_000,
      heartbeatIntervalMs: 10,
      heartbeatFailureLimit: 3,
    })
    const socket = await connectHeartbeatBridge(bridge)
    socket.ping.mockImplementation(() => {
      throw new Error('CDP ping write failed')
    })

    vi.advanceTimersByTime(10)

    expect(socket.terminate).toHaveBeenCalledTimes(1)
    expect(bridge.getStatus().connected).toBe(false)
    expect(bridge.getStatus().lastError).toBe('CDP ping write failed')
  })
})
