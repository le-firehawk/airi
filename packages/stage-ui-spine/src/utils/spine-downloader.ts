import type { Downloader } from '@esotericsoftware/spine-webgl'

type ZipDownloader = Pick<Downloader, 'downloadText' | 'downloadBinary' | 'rawDataUris'>

function isZipDownloader(value: unknown): value is ZipDownloader {
  if (typeof value !== 'object' || value === null)
    return false
  if (!('downloadText' in value) || typeof value.downloadText !== 'function')
    return false
  if (!('downloadBinary' in value) || typeof value.downloadBinary !== 'function')
    return false
  if (!('rawDataUris' in value) || typeof value.rawDataUris !== 'object' || value.rawDataUris === null)
    return false
  return Object.values(value.rawDataUris).every(uri => typeof uri === 'string')
}

/**
 * Reads the private downloader shared by supported Spine runtime versions.
 * The ZIP workaround requires these methods and validates them before mutation.
 * Remove this access when Spine provides a public buffer-aware asset loader.
 */
export function getSpineDownloader(assetManager: object): ZipDownloader | undefined {
  const downloader: unknown = Reflect.get(assetManager, 'downloader')
  return isZipDownloader(downloader) ? downloader : undefined
}
