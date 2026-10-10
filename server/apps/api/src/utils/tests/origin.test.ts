import { describe, expect, it } from 'vitest'

import { getTrustedOrigin, resolveCheckoutRedirectBase, resolveTrustedRequestOrigin } from '../origin'

describe('origin utils', () => {
  it('allows localhost origins', () => {
    expect(getTrustedOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('allows https localhost (mkcert dev)', () => {
    expect(getTrustedOrigin('https://localhost:5273')).toBe('https://localhost:5273')
    expect(getTrustedOrigin('https://127.0.0.1:5273')).toBe('https://127.0.0.1:5273')
  })

  it('allows the standalone auth UI origins', () => {
    expect(getTrustedOrigin('https://accounts.airi.build')).toBe('https://accounts.airi.build')
    expect(getTrustedOrigin('https://server-dev.airi-server-auth.pages.dev')).toBe('https://server-dev.airi-server-auth.pages.dev')
  })

  it('rejects retired management UI origins', () => {
    expect(getTrustedOrigin('https://admin.airi.build')).toBe('')
    expect(getTrustedOrigin('https://server-dev.airi-server-admin.pages.dev')).toBe('')
  })

  it('rejects private LAN Vite dev origins unless listed in ADDITIONAL_TRUSTED_ORIGINS', () => {
    expect(getTrustedOrigin('https://10.0.0.129:5273')).toBe('')
    expect(getTrustedOrigin('https://198.18.0.1:5273')).toBe('')
    expect(getTrustedOrigin('https://192.168.1.5:5273')).toBe('')

    const extra = ['https://10.0.0.129:5273', 'https://198.18.0.1:5273', 'https://192.168.1.5:5273']
    expect(getTrustedOrigin('https://10.0.0.129:5273', extra)).toBe('https://10.0.0.129:5273')
    expect(getTrustedOrigin('https://198.18.0.1:5273', extra)).toBe('https://198.18.0.1:5273')
    expect(getTrustedOrigin('https://192.168.1.5:5273', extra)).toBe('https://192.168.1.5:5273')
  })

  it('rejects untrusted origins', () => {
    expect(getTrustedOrigin('https://example.com')).toBe('')
  })

  it('prefers a trusted referer origin', () => {
    const request = new Request('http://localhost/api/v1/stripe/checkout', {
      headers: {
        referer: 'https://airi.moeru.ai/settings/flux',
        origin: 'https://example.com',
      },
    })

    expect(resolveTrustedRequestOrigin(request)).toBe('https://airi.moeru.ai')
  })

  it('falls back to a trusted origin header when referer is missing', () => {
    const request = new Request('http://localhost/api/v1/stripe/checkout', {
      headers: {
        origin: 'http://localhost:5173',
      },
    })

    expect(resolveTrustedRequestOrigin(request)).toBe('http://localhost:5173')
  })

  describe('resolveCheckoutRedirectBase', () => {
    const fallback = 'https://airi.moeru.ai'

    it('prefers the trusted request origin over the fallback', () => {
      const request = new Request('http://localhost/api/v1/stripe/checkout', {
        headers: { referer: 'http://localhost:5173/settings/flux' },
      })

      expect(resolveCheckoutRedirectBase(request, [], fallback)).toBe('http://localhost:5173')
    })

    // ROOT CAUSE:
    // Electron file:// requests lack trusted browser origins, so Stripe checkout rejected desktop users.
    // Origin-less clients now use the configured web app URL for Stripe redirects.
    // Web/mobile clients retain their trusted request origin.
    it('falls back to the web app URL when the request has no trusted origin (Electron file://)', () => {
      const request = new Request('http://localhost/api/v1/stripe/checkout', {
        method: 'POST',
        // file:// renderers send no Referer; Origin is absent or the opaque literal "null".
        headers: { origin: 'null' },
      })

      expect(resolveTrustedRequestOrigin(request, [])).toBeUndefined()
      expect(resolveCheckoutRedirectBase(request, [], fallback)).toBe(fallback)
    })

    it('falls back to the web app URL for an untrusted web origin', () => {
      const request = new Request('http://localhost/api/v1/stripe/checkout', {
        headers: { origin: 'https://evil.example.com' },
      })

      expect(resolveCheckoutRedirectBase(request, [], fallback)).toBe(fallback)
    })
  })
})
