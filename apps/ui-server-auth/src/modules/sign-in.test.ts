import { describe, expect, it, vi } from 'vitest'

import {
  createServerSignInContext,
  requestSocialSignInRedirect,
  SocialSignInTimeoutError,
} from './sign-in'

describe('ui-server-auth sign-in flow helpers', () => {
  it('rebuilds the OIDC callback URL without provider and prompt query params', () => {
    expect(createServerSignInContext(
      'https://auth.airi.test/sign-in?api_server_url=https%3A%2F%2Fapi-dev.airi.build&client_id=airi-stage-web&provider=github&prompt=login&response_type=code&scope=openid',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: 'https://api.airi.test/api/auth/oauth2/authorize?client_id=airi-stage-web&response_type=code&scope=openid',
      requestedProvider: 'github',
    })
  })

  it('falls back to the root path when no OIDC parameters are present', () => {
    expect(createServerSignInContext(
      'https://auth.airi.test/sign-in',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: '/',
      requestedProvider: null,
    })
  })

  // ROOT CAUSE:
  // Password-reset token queries reached sign-in and became invalid OIDC authorize URLs.
  // Require client_id and response_type before continuing OIDC. Otherwise use the standalone redirect.
  // Source: better-auth/dist/api/routes/password.mjs, redirectCallback.
  it('ignores stray non-OIDC query params (Issue: production reset-password token leaking into authorize URL)', () => {
    expect(createServerSignInContext(
      'https://auth.airi.test/sign-in?token=4HEMlnagmOESfes99kW5nNmZ',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: '/',
      requestedProvider: null,
    })
  })

  it('still falls back when the OIDC handoff is partial (client_id without response_type)', () => {
    expect(createServerSignInContext(
      'https://auth.airi.test/sign-in?client_id=airi-stage-web&scope=openid',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: '/',
      requestedProvider: null,
    })
  })

  it('normalizes standalone UI redirects under the deployed /ui base', () => {
    expect(createServerSignInContext(
      'https://auth.airi.test/ui/sign-in?redirect=%2Fprofile%3Ftab%3Dsecurity',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: 'https://auth.airi.test/ui/profile?tab=security',
      requestedProvider: null,
    })

    expect(createServerSignInContext(
      'https://auth.airi.test/ui/sign-in?redirect=%2Fauth%2Freset-password%3Ftoken%3Dold-link',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: 'https://auth.airi.test/ui/reset-password?token=old-link',
      requestedProvider: null,
    })
  })

  it('keeps trusted standalone admin redirects on the admin origin', () => {
    expect(createServerSignInContext(
      'https://accounts.airi.build/ui/sign-in?redirect=https%3A%2F%2Fadmin.airi.build%2Fllm-router%3Fapi_server_url%3Dhttps%253A%252F%252Fapi-dev.airi.build',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: 'https://admin.airi.build/llm-router?api_server_url=https%3A%2F%2Fapi-dev.airi.build',
      requestedProvider: null,
    })

    expect(createServerSignInContext(
      'https://accounts.airi.build/ui/sign-in?redirect=http%3A%2F%2F127.0.0.1%3A5178%2Fllm-router%3Fapi_server_url%3Dhttp%253A%252F%252F127.0.0.1%253A3000',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: 'http://127.0.0.1:5178/llm-router?api_server_url=http%3A%2F%2F127.0.0.1%3A3000',
      requestedProvider: null,
    })
  })

  it('rejects absolute redirects to untrusted origins', () => {
    expect(createServerSignInContext(
      'https://accounts.airi.build/ui/sign-in?redirect=https%3A%2F%2Fevil.example%2Fllm-router',
      'https://api.airi.test',
    )).toEqual({
      callbackURL: '/',
      requestedProvider: null,
    })
  })

  it('posts the selected provider and callback URL to the social sign-in endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ url: 'https://accounts.example.test/oauth/google' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await expect(requestSocialSignInRedirect({
      apiServerUrl: 'https://api.airi.test',
      provider: 'google',
      callbackURL: 'https://api.airi.test/api/auth/oauth2/authorize?client_id=airi-stage-web',
      fetchImpl,
    })).resolves.toBe('https://accounts.example.test/oauth/google')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(url)).toBe('https://api.airi.test/api/auth/sign-in/social')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      provider: 'google',
      callbackURL: 'https://api.airi.test/api/auth/oauth2/authorize?client_id=airi-stage-web',
      disableRedirect: true,
    })
  })

  it('posts only the callback URL (no provider field) to the Steam sign-in endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ url: 'https://steamcommunity.com/openid/login?...', redirect: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await expect(requestSocialSignInRedirect({
      apiServerUrl: 'https://api.airi.test',
      provider: 'steam',
      callbackURL: 'https://api.airi.test/api/auth/oauth2/authorize?client_id=airi-stage-web',
      fetchImpl,
    })).resolves.toBe('https://steamcommunity.com/openid/login?...')

    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(url)).toBe('https://api.airi.test/api/auth/sign-in/steam')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      callbackURL: 'https://api.airi.test/api/auth/oauth2/authorize?client_id=airi-stage-web',
      disableRedirect: true,
    })
  })

  it('surfaces server-provided sign-in errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({
        error: {
          message: 'Provider is temporarily unavailable',
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await expect(requestSocialSignInRedirect({
      apiServerUrl: 'https://api.airi.test',
      provider: 'github',
      callbackURL: '/',
      fetchImpl,
    })).rejects.toThrow('Provider is temporarily unavailable')
  })

  it.each(['google', 'steam'] as const)('aborts a stalled %s request when the provider timeout wins', async (provider) => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | null | undefined
    let didAbort = false
    const fetchImpl = vi.fn<typeof fetch>((_, init) => {
      const signal = init?.signal
      requestSignal = signal

      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => {
          didAbort = true
          reject(signal.reason)
        }, { once: true })
      })
    })

    try {
      const request = requestSocialSignInRedirect({
        apiServerUrl: 'https://api.airi.test',
        provider,
        callbackURL: '/',
        fetchImpl,
        timeoutMs: 50,
      })

      const rejection = expect(request).rejects.toBeInstanceOf(SocialSignInTimeoutError)
      await vi.advanceTimersByTimeAsync(50)
      await rejection
      expect(requestSignal?.aborted).toBe(true)
      expect(didAbort).toBe(true)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
