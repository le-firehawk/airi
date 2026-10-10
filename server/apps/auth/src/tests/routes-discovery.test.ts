import Redis from 'ioredis'

import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { createAuth } from '../auth'
import { createAuthDrizzle } from '../db'
import { buildAuthApp } from '../server'
import { createTestAuthEnv } from './auth-fixtures'

async function createApp(publicUrl: string) {
  const env = createTestAuthEnv({ PUBLIC_URL: publicUrl })
  const { db, pool } = createAuthDrizzle(env)
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true })
  onTestFinished(async () => {
    redis.disconnect()
    await pool.end()
  })
  const connectDatabase = vi.spyOn(pool, 'connect')
  const connectRedis = vi.spyOn(redis, 'connect')
  const auth = createAuth(db, env)
  const handler = vi.spyOn(auth, 'handler')
  const getOAuthServerConfig = vi.spyOn(auth.api, 'getOAuthServerConfig')
  const getOpenIdConfig = vi.spyOn(auth.api, 'getOpenIdConfig')
  const { app } = await buildAuthApp({ auth, db, redis, env })

  return { app, handler, getOAuthServerConfig, getOpenIdConfig, connectDatabase, connectRedis }
}

describe.each(['http://localhost:6112', 'https://api.airi.build'])('auth discovery at %s', (publicUrl) => {
  it('serves OAuth metadata at the root-level path with the issuer suffix', async () => {
    const { app, handler, getOAuthServerConfig, getOpenIdConfig, connectDatabase, connectRedis } = await createApp(publicUrl)
    const response = await app.request(`${publicUrl}/.well-known/oauth-authorization-server/api/auth`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({
      issuer: `${publicUrl}/api/auth`,
      authorization_endpoint: `${publicUrl}/api/auth/oauth2/authorize`,
      token_endpoint: `${publicUrl}/api/auth/oauth2/token`,
      jwks_uri: `${publicUrl}/api/auth/jwks`,
      scopes_supported: expect.arrayContaining(['openid', 'profile', 'email']),
      code_challenge_methods_supported: ['S256'],
    })
    expect(getOAuthServerConfig).toHaveBeenCalledExactlyOnceWith()
    expect(getOpenIdConfig).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(connectDatabase).not.toHaveBeenCalled()
    expect(connectRedis).not.toHaveBeenCalled()
  })

  it('serves OpenID metadata below the issuer path', async () => {
    const { app, handler, getOAuthServerConfig, getOpenIdConfig, connectDatabase, connectRedis } = await createApp(publicUrl)
    const response = await app.request(`${publicUrl}/api/auth/.well-known/openid-configuration`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({
      issuer: `${publicUrl}/api/auth`,
      authorization_endpoint: `${publicUrl}/api/auth/oauth2/authorize`,
      token_endpoint: `${publicUrl}/api/auth/oauth2/token`,
      userinfo_endpoint: `${publicUrl}/api/auth/oauth2/userinfo`,
      jwks_uri: `${publicUrl}/api/auth/jwks`,
      scopes_supported: expect.arrayContaining(['openid', 'profile', 'email']),
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
    })
    expect(getOpenIdConfig).toHaveBeenCalledExactlyOnceWith()
    expect(getOAuthServerConfig).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(connectDatabase).not.toHaveBeenCalled()
    expect(connectRedis).not.toHaveBeenCalled()
  })
})

describe('auth discovery configuration', () => {
  // ROOT CAUSE:
  // The plugin cannot inspect Hono routes and requires acknowledgement of the root-level OAuth metadata endpoint.
  // The acknowledgement records the existing route after its real metadata passes the route tests.
  it('acknowledges the root-level OAuth discovery route after serving its metadata', async () => {
    const warning = vi.spyOn(console, 'warn')
    onTestFinished(() => warning.mockRestore())
    const { app } = await createApp('https://api.airi.build')
    const response = await app.request('/.well-known/oauth-authorization-server/api/auth')

    expect(response.status).toBe(200)
    expect(warning).not.toHaveBeenCalledWith(expect.stringContaining('silenceWarnings.oauthAuthServerConfig.'))
  })
})
