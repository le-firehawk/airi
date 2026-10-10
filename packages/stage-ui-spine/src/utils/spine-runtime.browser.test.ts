import type { SpineCanvas, SpineModel } from './spine-canvas'
import type { SpineVersion } from './spine-version'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as sdk42 from '@esotericsoftware/spine-webgl'
import * as sdk40 from '@esotericsoftware/spine-webgl-4-0'
import * as sdk41 from '@esotericsoftware/spine-webgl-4-1'

import { getSpineDownloader } from './spine-downloader'
import { loadSpineRuntime } from './spine-runtime'

const owned: SpineCanvas[] = []
const elements: HTMLCanvasElement[] = []

afterEach(() => {
  for (const canvas of owned.splice(0))
    canvas.dispose()
  for (const element of elements.splice(0))
    element.remove()
  vi.restoreAllMocks()
})

const versions: { version: SpineVersion, sdk: typeof sdk40 | typeof sdk41 | typeof sdk42 }[] = [
  { version: '4.0', sdk: sdk40 },
  { version: '4.1', sdk: sdk41 },
  { version: '4.2', sdk: sdk42 },
]

describe.each(versions)('spine $version adapter', ({ version, sdk }) => {
  it('uses matching skeleton physics, background blending, and disposal', async () => {
    const runtime = await loadSpineRuntime(version)
    const element = document.createElement('canvas')
    element.width = 64
    element.height = 64
    element.style.width = '64px'
    element.style.height = '64px'
    document.body.appendChild(element)
    elements.push(element)
    const physics = vi.spyOn(sdk.Skeleton.prototype, 'updateWorldTransform')
    const blend = vi.spyOn(sdk.PolygonBatcher.prototype, 'setBlendMode')
    const releaseAssets = vi.spyOn(sdk.AssetManagerBase.prototype, 'dispose')
    const releaseRenderer = vi.spyOn(sdk.SceneRenderer.prototype, 'dispose')
    const releaseTexture = vi.spyOn(sdk.GLTexture.prototype, 'dispose')
    const update = vi.fn()
    let model: SpineModel | undefined
    const ready = Promise.withResolvers<void>()
    const canvas = runtime.createCanvas(element, {
      app: {
        loadAssets(canvas) {
          const downloader = getSpineDownloader(canvas.assetManager.source)
          if (!downloader)
            throw new Error('Missing SDK downloader.')
          downloader.downloadText = (path, success) => {
            queueMicrotask(() => success(path.endsWith('.atlas')
              ? ''
              : JSON.stringify({
                  skeleton: { spine: `${version}.0` },
                  bones: [{ name: 'root' }],
                })))
          }
          canvas.assetManager.loadJson('model.json')
          canvas.assetManager.loadTextureAtlas('model.atlas')
        },
        initialize(canvas) {
          model = canvas.createModel('model.json', 'model.atlas', 'json')
          model.updateWorldTransform()
          ready.resolve()
        },
        update,
        error: (_canvas, errors) => ready.reject(new Error(JSON.stringify(errors))),
      },
    })
    owned.push(canvas)
    await ready.promise
    if (!model)
      throw new Error('Expected the matching runtime model.')
    model.update(0.016)
    if ('Physics' in sdk)
      expect(physics).toHaveBeenLastCalledWith(sdk.Physics.update)
    else
      expect(physics).toHaveBeenLastCalledWith()

    const image = new Image()
    const pixel = document.createElement('canvas')
    pixel.width = 1
    pixel.height = 1
    image.src = pixel.toDataURL('image/png')
    await image.decode()
    const texture = canvas.createTexture(image)
    canvas.begin()
    texture.draw(0, 0, 1, 1)
    canvas.end()
    if (version === '4.0') {
      const gl = element.getContext('webgl2') ?? element.getContext('webgl')
      if (!gl)
        throw new Error('Expected the adapter WebGL context.')
      expect(blend).toHaveBeenLastCalledWith(gl.SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }
    else {
      expect(blend).toHaveBeenLastCalledWith(sdk.BlendMode.Normal, false)
    }
    canvas.dispose()
    expect(releaseTexture).toHaveBeenCalledOnce()
    texture.dispose()
    expect(releaseTexture).toHaveBeenCalledOnce()
    const frames = update.mock.calls.length
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    expect(update).toHaveBeenCalledTimes(frames)
    expect(releaseAssets).toHaveBeenCalledOnce()
    expect(releaseRenderer).toHaveBeenCalledOnce()
  })
})
