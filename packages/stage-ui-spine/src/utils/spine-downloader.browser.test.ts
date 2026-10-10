import { Downloader } from '@esotericsoftware/spine-webgl'
import { describe, expect, it } from 'vitest'

import { getSpineDownloader } from './spine-downloader'

describe('spine ZIP downloader access', () => {
  it('keeps the runtime downloader identity', () => {
    const downloader = new Downloader()
    expect(getSpineDownloader({ downloader })).toBe(downloader)
  })

  it('rejects missing and incompatible private fields', () => {
    expect(getSpineDownloader({})).toBeUndefined()
    expect(getSpineDownloader({ downloader: null })).toBeUndefined()
    expect(getSpineDownloader({ downloader: { rawDataUris: {} } })).toBeUndefined()
    const downloader = new Downloader()
    Reflect.set(downloader, 'rawDataUris', { texture: 4 })
    expect(getSpineDownloader({ downloader })).toBeUndefined()
  })
})
