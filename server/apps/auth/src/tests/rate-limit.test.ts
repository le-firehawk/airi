import type { AuthRoutesDeps, HonoEnv } from '../routes'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { createAuthRoutes } from '../routes'
import { createTestAuthDatabase, createTestAuthEnv } from './auth-fixtures'

async function createApp(trustedProxy?: 'railway') {
  const db = createTestAuthDatabase()
  const env = createTestAuthEnv({
    PUBLIC_URL: 'https://api.airi.build',
    AUTH_UI_URL: 'https://accounts.airi.build/ui',
    ADDITIONAL_TRUSTED_ORIGINS: [],
    RATE_LIMIT_TRUSTED_PROXY: trustedProxy,
  })
  const auth: AuthRoutesDeps['auth'] = {
    handler: vi.fn(async () => new Response(null, { status: 200 })),
    api: {
      getSession: vi.fn(async () => null),
      getJwks: vi.fn(async () => ({ keys: [] })),
      getOAuthServerConfig: vi.fn(async () => { throw new Error('Metadata is not used by rate-limit tests') }),
      getOpenIdConfig: vi.fn(async () => { throw new Error('Metadata is not used by rate-limit tests') }),
    },
  }
  const routes = await createAuthRoutes({ auth, db, env, rateLimitMetrics: null })

  return new Hono<HonoEnv>().route('/', routes)
}

async function listen(app: Hono<HonoEnv>, hostname = '127.0.0.1') {
  const server = serve({ fetch: app.fetch, port: 0, hostname })
  const port = await new Promise<number>((resolve, reject) => {
    function onError(error: Error) {
      server.off('listening', onListening)
      reject(error)
    }
    function onListening() {
      server.off('error', onError)
      const address = server.address()
      if (address && typeof address === 'object')
        resolve(address.port)
      else
        reject(new Error('The test server did not bind a TCP address'))
    }
    server.once('error', onError)
    server.once('listening', onListening)
  })

  return {
    origin: `http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    }),
  }
}

function request(origin: string, clientAddress: string) {
  return fetch(`${origin}/api/auth/get-session`, {
    headers: {
      'connection': 'close',
      'x-real-ip': clientAddress,
    },
  })
}

describe('auth API rate limiting behind Railway', () => {
  it('uses one fixed 20-request bucket when proxy trust is disabled', async () => {
    const server = await listen(await createApp())

    try {
      for (let index = 0; index < 20; index += 1)
        expect((await request(server.origin, `203.0.113.${index + 1}`)).status).toBe(200)

      expect((await request(server.origin, '203.0.113.21')).status).toBe(429)
    }
    finally {
      await server.close()
    }
  })

  it('uses the forwarded client IP over an IPv6 gateway socket', async () => {
    // ROOT CAUSE:
    // Origin-derived proxy trust failed after moving to Caddy. IPv4-only trust also missed Railway's IPv6 proxy sockets.
    // Explicit deployment settings now control trust, while X-Real-IP validation is independent of transport family.
    const server = await listen(await createApp('railway'), '::1')

    try {
      for (let index = 0; index < 20; index += 1)
        expect((await request(server.origin, '203.0.113.10')).status).toBe(200)

      expect((await request(server.origin, '203.0.113.10')).status).toBe(429)
      expect((await request(server.origin, '203.0.113.11')).status).toBe(200)
    }
    finally {
      await server.close()
    }
  })
})
