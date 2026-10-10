import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const publicDirectory = resolve(import.meta.dirname, '..', 'public')

describe('cloudflare Pages routing', () => {
  it('keeps missing static assets as 404 responses while preserving the /ui SPA fallback', async () => {
    // ROOT CAUSE:
    // Without 404.html, Pages returned index.html for missing assets and cached HTML at immutable asset URLs.
    // Keep the SPA rewrite under /ui/* and provide a top-level 404 document for other missing paths.
    const [notFoundPage, redirects] = await Promise.all([
      readFile(resolve(publicDirectory, '404.html'), 'utf8'),
      readFile(resolve(publicDirectory, '_redirects'), 'utf8'),
    ])

    expect(notFoundPage).toContain('<title>Page not found</title>')
    expect(redirects).toContain('/ui/* / 200')
  })

  it('requires old and current asset namespaces to revalidate cached responses', async () => {
    const headers = await readFile(resolve(publicDirectory, '_headers'), 'utf8')

    expect(headers).toContain('/assets/*\n  cache-control: public, no-cache')
    expect(headers).toContain('/assets-v2/*\n  cache-control: public, no-cache')
    expect(headers).not.toContain('immutable')
  })
})
