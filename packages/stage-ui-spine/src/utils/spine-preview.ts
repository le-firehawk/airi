import type { SpineCanvas, SpineCanvasApp, SpineModel } from './spine-canvas'

import { getSpineDownloader } from './spine-downloader'
import { loadSpineRuntime } from './spine-runtime'
import { detectSpineVersionFromBinary, detectSpineVersionFromJson } from './spine-version'
import { loadSpineZip } from './spine-zip-loader'

/**
 * Renders the first frame of a user-imported Spine ZIP to an offscreen
 * canvas and returns a data URL suitable for the model-selector grid.
 *
 * Use when:
 * - A user imports a `.zip` Spine model and the display-models store
 *   needs a thumbnail for the catalog tile.
 *
 * Expects:
 * - The ZIP passes `validateSpineZip()`; otherwise this returns `undefined`.
 *
 * Returns:
 * - A `data:image/png` URL when rendering succeeds, otherwise `undefined`.
 */
export async function loadSpineModelPreview(file: File): Promise<string | undefined> {
  let assets: Awaited<ReturnType<typeof loadSpineZip>> | undefined
  let canvas: HTMLCanvasElement | undefined
  let spineCanvas: SpineCanvas | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    assets = await loadSpineZip(file)

    let detectedVersion = assets.layout.skeletonFormat === 'binary'
      ? detectSpineVersionFromBinary(assets.rawData[assets.layout.skeletonPath] as Uint8Array)
      : detectSpineVersionFromJson(assets.rawData[assets.layout.skeletonPath] as string)
    if (!detectedVersion)
      detectedVersion = '4.2'
    const spine = await loadSpineRuntime(detectedVersion)

    const previewWidth = 720
    const previewHeight = 960

    canvas = document.createElement('canvas')
    canvas.width = previewWidth
    canvas.height = previewHeight
    canvas.style.width = `${previewWidth}px`
    canvas.style.height = `${previewHeight}px`
    canvas.style.position = 'absolute'
    canvas.style.left = '-99999px'
    canvas.style.top = '0'
    document.body.appendChild(canvas)

    const layout = assets.layout
    const blobUrls = assets.blobUrls
    const rawData = assets.rawData

    const skeletonAssetPath = layout.skeletonPath
    const atlasAssetPath = layout.atlasPath

    return await new Promise<string | undefined>((resolve) => {
      let resolved = false
      const finish = (value: string | undefined) => {
        if (resolved)
          return
        resolved = true
        resolve(value)
      }

      try {
        let previewSkeleton: SpineModel | undefined
        const app: SpineCanvasApp = {
          dispose: () => finish(undefined),
          loadAssets: (canvasApp: SpineCanvas) => {
            // NOTICE:
            // Patch BEFORE any load calls. SpineCanvas calls loadAssets
            // synchronously in its constructor, and load methods immediately
            // dispatch XHR. Patching after the constructor is too late.
            // Source/context: spine-core/AssetManagerBase.js Downloader class.
            // Removal condition: Spine ships a Blob/buffer-aware loader.
            const am = canvasApp.assetManager
            patchAssetManagerForZipAssets(am.source, blobUrls, rawData, layout.texturePaths)

            if (layout.skeletonFormat === 'binary')
              am.loadBinary(skeletonAssetPath)
            else
              am.loadJson(skeletonAssetPath)

            // loadTextureAtlas loads every page image referenced by the atlas
            // through the patched downloader, so the texture pages do not need
            // to be requested again individually.
            am.loadTextureAtlas(atlasAssetPath)
          },
          initialize: (canvasApp: SpineCanvas) => {
            const skeleton = canvasApp.createModel(skeletonAssetPath, atlasAssetPath, layout.skeletonFormat)
            // Some rigs need their first skin because they have no default skin.
            if (!skeleton.defaultSkinName && skeleton.skins.length > 0) {
              skeleton.setSkinByName(skeleton.skins[0].name)
              skeleton.setSlotsToSetupPose()
            }
            previewSkeleton = skeleton
          },
          update: (_canvasApp: SpineCanvas, _delta: number) => {
            const skeleton = previewSkeleton
            skeleton?.updateWorldTransform()
          },
          error: () => finish(undefined),
          render: (canvasApp: SpineCanvas) => {
            const skeleton = previewSkeleton
            if (!skeleton)
              return

            // Frame the camera around the posed skeleton bounds.
            // Most rigs anchor their feet at the origin, so the default camera crops their upper body.
            // Centering the bounds and adding a margin keeps the complete model visible.
            const bounds = skeleton.getBounds()
            const camera = canvasApp.camera
            if (bounds.width > 0 && bounds.height > 0) {
              const padding = 1.1
              camera.position.x = bounds.x + bounds.width / 2
              camera.position.y = bounds.y + bounds.height / 2
              camera.zoom = Math.max(bounds.width / camera.viewportWidth, bounds.height / camera.viewportHeight) * padding
              camera.update()
            }
            canvasApp.begin()
            try {
              skeleton.draw(true)
            }
            finally {
              canvasApp.end()
            }

            // Wait for a valid bounding box before capturing. A degenerate box
            // (empty setup pose, attachments not yet resolved) would produce a
            // blank or mis-framed thumbnail, so retry on the next frame instead.
            if (bounds.width <= 0 || bounds.height <= 0)
              return

            try {
              const dataUrl = canvas!.toDataURL('image/png')
              finish(dataUrl)
            }
            catch (err) {
              console.error('[Spine] Failed to capture preview:', err)
              finish(undefined)
            }
          },
        }

        // Use a custom path handler so AssetManager fetches go through our
        // blob URLs instead of trying the resolved path on the network.
        spineCanvas = spine.createCanvas(canvas!, {
          app,
          pathPrefix: '',
          webglConfig: { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true },
        })
      }
      catch (err) {
        console.error('[Spine] Preview generation failed:', err)
        finish(undefined)
      }

      // Hard timeout so a stuck load can't block the import flow.
      timeout = setTimeout(finish, 4000, undefined)
    })
  }
  catch (err) {
    console.error('[Spine] Preview generation failed:', err)
    return undefined
  }
  finally {
    if (timeout !== undefined)
      clearTimeout(timeout)
    try {
      spineCanvas?.dispose()
    }
    finally {
      if (canvas?.isConnected)
        canvas.remove()
      assets?.dispose()
    }
  }
}

/**
 * Patches the AssetManager's Downloader to serve ZIP-extracted assets from
 * memory, bypassing the broken rawDataUris heuristic.
 *
 * NOTICE:
 * Spine's Downloader.rawDataUris treats values without "." as data: URIs
 * (atob decode). Blob URLs in Electron are `blob:null/<uuid>` (no dots) →
 * misidentified as data URIs → status 400. Even real data: URIs corrupt
 * multi-byte binary via atob round-trip.
 * Source: spine-core/AssetManagerBase.js Downloader class.
 * Removal condition: Spine ships a Blob/ArrayBuffer-aware asset loader.
 */
function patchAssetManagerForZipAssets(
  assetManager: object,
  blobUrls: Record<string, string>,
  rawData: Record<string, Uint8Array | string>,
  texturePaths: string[],
) {
  const downloader = getSpineDownloader(assetManager)
  if (!downloader)
    return

  const textLookup = new Map<string, string>()
  const binaryLookup = new Map<string, Uint8Array>()
  for (const [path, data] of Object.entries(rawData)) {
    const bare = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
    if (typeof data === 'string') {
      textLookup.set(path, data)
      textLookup.set(bare, data)
    }
    else {
      binaryLookup.set(path, data)
      binaryLookup.set(bare, data)
    }
  }

  const origDownloadText = downloader.downloadText.bind(downloader)
  const origDownloadBinary = downloader.downloadBinary.bind(downloader)

  downloader.downloadText = (url, success, error) => {
    const data = textLookup.get(url)
    if (data !== undefined) {
      queueMicrotask(() => success(data))
      return
    }
    origDownloadText(url, success, error)
  }

  downloader.downloadBinary = (url, success, error) => {
    const data = binaryLookup.get(url)
    if (data !== undefined) {
      queueMicrotask(() => success(data))
      return
    }
    origDownloadBinary(url, success, error)
  }

  for (const path of texturePaths) {
    const url = blobUrls[path]
    if (!url)
      continue
    downloader.rawDataUris[path] = url
    const slash = path.lastIndexOf('/')
    if (slash !== -1)
      downloader.rawDataUris[path.slice(slash + 1)] = url
  }
}
