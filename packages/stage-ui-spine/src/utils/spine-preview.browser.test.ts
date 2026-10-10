import type { SpineVersion } from './spine-version'

import JSZip from 'jszip'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as sdk42 from '@esotericsoftware/spine-webgl'
import * as sdk40 from '@esotericsoftware/spine-webgl-4-0'
import * as sdk41 from '@esotericsoftware/spine-webgl-4-1'

import { loadSpineModelPreview } from './spine-preview'

const versions: { version: SpineVersion, sdk: typeof sdk40 | typeof sdk41 | typeof sdk42 }[] = [
  { version: '4.0', sdk: sdk40 },
  { version: '4.1', sdk: sdk41 },
  { version: '4.2', sdk: sdk42 },
]

afterEach(() => vi.restoreAllMocks())

async function createPreviewZip(version: SpineVersion, visible: boolean) {
  const zip = new JSZip()
  const pixel = document.createElement('canvas')
  pixel.width = 1
  pixel.height = 1
  const context = pixel.getContext('2d')
  if (!context)
    throw new Error('Expected a native canvas context.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 1, 1)
  const blob = await new Promise<Blob>((resolve, reject) => pixel.toBlob((value) => {
    if (value)
      resolve(value)
    else
      reject(new Error('Unable to create texture.'))
  }))
  zip.file('pixel.png', await blob.arrayBuffer())
  // The empty model still needs a texture page so every SDK completes asset loading.
  zip.file('model.atlas', 'pixel.png\nsize: 1,1\nformat: RGBA8888\nfilter: Nearest,Nearest\nrepeat: none\npixel\n  rotate: false\n  xy: 0, 0\n  size: 1, 1\n  orig: 1, 1\n  offset: 0, 0\n  index: -1\n')
  zip.file('model.json', JSON.stringify({
    skeleton: { spine: `${version}.0` },
    bones: [{ name: 'root', x: 100, y: 200 }],
    slots: visible ? [{ name: 'slot', bone: 'root', attachment: 'pixel' }] : [],
    skins: visible ? [{ name: 'default', attachments: { slot: { pixel: { type: 'region', path: 'pixel', width: 1, height: 1 } } } }] : [],
  }))
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'model.zip', { type: 'application/zip' })
}

describe.each(versions)('spine $version preview cleanup', ({ version, sdk }) => {
  it('releases the canvas and assets after successful capture', async () => {
    const releaseRenderer = vi.spyOn(sdk.SceneRenderer.prototype, 'dispose')
    const releaseAssets = vi.spyOn(sdk.AssetManagerBase.prototype, 'dispose')
    const previousCanvases = document.querySelectorAll('canvas').length
    const result = await loadSpineModelPreview(await createPreviewZip(version, true))
    expect(result).toMatch(/^data:image\/png/)
    if (!result)
      throw new Error('Expected a captured preview.')
    const image = new Image()
    image.src = result
    await image.decode()
    const captured = document.createElement('canvas')
    captured.width = image.width
    captured.height = image.height
    const context = captured.getContext('2d')
    if (!context)
      throw new Error('Expected a native canvas context.')
    context.drawImage(image, 0, 0)
    // A tiny, offset model must be framed before the first GPU draw.
    expect(context.getImageData(Math.floor(image.width / 4), Math.floor(image.height / 2), 1, 1).data[3]).toBeGreaterThan(0)
    expect(document.querySelectorAll('canvas')).toHaveLength(previousCanvases)
    expect(releaseRenderer).toHaveBeenCalledOnce()
    expect(releaseAssets).toHaveBeenCalledOnce()
  })

  it('releases a zero-bounds model when preview capture times out', async () => {
    const releaseRenderer = vi.spyOn(sdk.SceneRenderer.prototype, 'dispose')
    const assetsReady = vi.spyOn(sdk.AssetManagerBase.prototype, 'isLoadingComplete')
    const measureBounds = vi.spyOn(sdk.Skeleton.prototype, 'getBounds')
    const previousCanvases = document.querySelectorAll('canvas').length
    const result = await loadSpineModelPreview(await createPreviewZip(version, false))
    expect(assetsReady).toHaveReturnedWith(true)
    expect(measureBounds).toHaveBeenCalled()
    const [, size] = measureBounds.mock.calls[0]
    expect(size.x).toBeLessThanOrEqual(0)
    expect(size.y).toBeLessThanOrEqual(0)
    expect(result).toBeUndefined()
    expect(document.querySelectorAll('canvas')).toHaveLength(previousCanvases)
    expect(releaseRenderer).toHaveBeenCalledOnce()
  }, 10_000)
})
