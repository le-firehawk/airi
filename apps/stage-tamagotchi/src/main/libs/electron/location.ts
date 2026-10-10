import type { BrowserWindow, LoadFileOptions, LoadURLOptions } from 'electron'

import { join } from 'node:path'
import { env } from 'node:process'

import { is } from '@electron-toolkit/utils'

let electronMainDirname: string = ''

export function setElectronMainDirname(dirname: string) {
  electronMainDirname = dirname
}

export function getElectronMainDirname() {
  return electronMainDirname
}

export function baseUrl(parentOfIndexHtml: string, filename?: string) {
  if (is.dev && env.ELECTRON_RENDERER_URL) {
    if (!filename) {
      return { url: env.ELECTRON_RENDERER_URL }
    }

    const url = new URL(env.ELECTRON_RENDERER_URL)
    const paths = url.pathname.split('/')
    paths.pop()
    paths.push(filename)
    url.pathname = paths.join('/')
    return { url: url.toString() }
  }
  else {
    return { file: join(parentOfIndexHtml, filename ?? 'index.html') }
  }
}

export async function load(window: BrowserWindow, url: string | { url: string, options?: LoadURLOptions } | { file: string, options?: LoadFileOptions }) {
  try {
    if (typeof url === 'object' && 'url' in url) {
      return await window.loadURL(url.url, url.options)
    }
    if (typeof url === 'object' && 'file' in url) {
      return await window.loadFile(url.file, url.options)
    }

    return await window.loadURL(url)
  }
  catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    // Electron navigation error shape
    // https://github.com/electron/electron/blob/8d05285a1f39c759985b17c89a449e4a6b3960df/lib/browser/api/web-contents.ts#L354-L359
    if (!('code' in error) || !('errno' in error)) {
      throw error
    }
    if (error.code === 'ERR_ABORTED' && error.errno === -3) {
      if (typeof url === 'object' && 'url' in url) {
        const parsedURL = new URL(url.url)
        if (parsedURL.hash) {
          // NOTICE:
          // Electron can reject a hash-route load with ERR_ABORTED even when navigation succeeds.
          // URL normalization inserts a slash before the hash.
          // Sources: https://github.com/electron/electron/issues/17526 and https://github.com/elect
          // ron/electron/blob/8d05285a1f39c759985b17c89a449e4a6b3960df/lib/browser/api/web-
          // contents.ts#L370-L387.
          // Remove this exception when Electron resolves successful hash-route loads.
          console.warn('Electron navigation error with hash route, ignoring:', error, 'url:', url.url)

          return
        }
      }
    }

    throw error
  }
  finally {
    window.webContents.removeAllListeners('did-start-navigation')
  }
}

/**
 * Adds a hash route and optional query to an Electron renderer location.
 *
 * @example
 * withHashRoute({ url: 'http://localhost:5173' }, '/about', {
 *   query: { 'synced-leader': 'false' },
 * })
 * // => { url: 'http://localhost:5173/?synced-leader=false#/about' }
 */
export function withHashRoute(
  baseUrl: string | { url: string } | { file: string },
  hashRoute: string,
  options: Pick<LoadFileOptions, 'query'> = {},
) {
  if (typeof baseUrl === 'object' && 'url' in baseUrl) {
    // trim `/` suffix
    const baseURLinURL = new URL(baseUrl.url)

    const pathname = baseURLinURL.pathname
    const trimmedPathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
    baseURLinURL.pathname = trimmedPathname

    for (const [key, value] of Object.entries(options.query ?? {}))
      baseURLinURL.searchParams.set(key, value)

    baseURLinURL.hash = hashRoute

    return { url: baseURLinURL.toString() } satisfies { url: string, options?: LoadURLOptions }
  }
  if (typeof baseUrl === 'object' && 'file' in baseUrl) {
    return { file: `${baseUrl.file}`, options: { hash: hashRoute, ...options } } satisfies { file: string, options?: LoadFileOptions }
  }

  // trim `/` suffix
  const baseURLinURL = new URL(baseUrl)

  const pathname = baseURLinURL.pathname
  const trimmedPathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  baseURLinURL.pathname = trimmedPathname

  for (const [key, value] of Object.entries(options.query ?? {}))
    baseURLinURL.searchParams.set(key, value)

  baseURLinURL.hash = hashRoute

  return { url: baseURLinURL.toString() } satisfies { url: string, options?: LoadURLOptions }
}
