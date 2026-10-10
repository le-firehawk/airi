import type { SpineCanvasFactory } from './spine-canvas'

import * as spine from '@esotericsoftware/spine-webgl'

import { SpineCanvas } from './spine-canvas'

/** Creates a 4.2 canvas without exposing its SDK objects to other versions. */
export const createCanvas: SpineCanvasFactory = (canvas, config) => {
  const gl = canvas.getContext('webgl2', config.webglConfig) ?? canvas.getContext('webgl', config.webglConfig)
  if (!gl)
    throw new Error('WebGL is unavailable.')
  // AIRI owns context-loss listeners, including for SDK versions without listener disposal.
  const context = new spine.ManagedWebGLRenderingContext(gl)
  const renderer = new spine.SceneRenderer(canvas, context)
  let disposed = false
  const assets = new spine.AssetManagerBase((image) => {
    const texture = new spine.GLTexture(context, image)
    if (disposed)
      texture.dispose()
    return texture
  }, config.pathPrefix ?? '')
  const time = new spine.TimeKeeper()
  const backgroundTextures = new Set<spine.GLTexture>()

  return new SpineCanvas({
    assetManager: {
      source: assets,
      loadBinary: path => assets.loadBinary(path, () => {
        if (disposed)
          assets.dispose()
      }),
      loadJson: path => assets.loadJson(path, () => {
        if (disposed)
          assets.dispose()
      }),
      loadTextureAtlas: path => assets.loadTextureAtlas(path, () => {
        if (disposed)
          assets.dispose()
      }),
      isLoadingComplete: () => assets.isLoadingComplete(),
      hasErrors: () => assets.hasErrors(),
      getErrors: () => assets.getErrors(),
    },
    camera: renderer.camera,
    createModel(skeletonPath, atlasPath, format, mix) {
      const atlas: unknown = assets.require(atlasPath)
      if (!(atlas instanceof spine.TextureAtlas))
        throw new TypeError('Expected a Spine texture atlas.')
      const loader = new spine.AtlasAttachmentLoader(atlas)
      const payload: unknown = assets.require(skeletonPath)
      let data: spine.SkeletonData
      if (format === 'binary') {
        if (!(payload instanceof Uint8Array))
          throw new TypeError('Expected binary Spine skeleton data.')
        data = new spine.SkeletonBinary(loader).readSkeletonData(payload)
      }
      else {
        if (typeof payload !== 'string' && (typeof payload !== 'object' || payload === null))
          throw new TypeError('Expected JSON Spine skeleton data.')
        data = new spine.SkeletonJson(loader).readSkeletonData(payload)
      }
      const skeleton = new spine.Skeleton(data)
      const stateData = new spine.AnimationStateData(data)
      stateData.defaultMix = mix
      const state = new spine.AnimationState(stateData)
      skeleton.setToSetupPose()

      return {
        get x() { return skeleton.x },
        set x(value) { skeleton.x = value },
        get y() { return skeleton.y },
        set y(value) { skeleton.y = value },
        get scaleX() { return skeleton.scaleX },
        set scaleX(value) { skeleton.scaleX = value },
        get scaleY() { return skeleton.scaleY },
        set scaleY(value) { skeleton.scaleY = value },
        animationState: {
          data: stateData,
          setAnimation: (track, name, loop) => state.setAnimation(track, name, loop),
          setEmptyAnimation: (track, duration) => { state.setEmptyAnimation(track, duration) },
          addListener: listener => state.addListener(listener),
          removeListener: listener => state.removeListener(listener),
        },
        animations: data.animations.map(animation => ({ name: animation.name, duration: animation.duration })),
        skins: data.skins.map(skin => ({ name: skin.name })),
        defaultSkinName: data.defaultSkin?.name,
        hasSkin: name => data.findSkin(name) !== null,
        setToSetupPose: () => skeleton.setToSetupPose(),
        setSkinByName: name => skeleton.setSkinByName(name),
        setSlotsToSetupPose: () => skeleton.setSlotsToSetupPose(),
        getBounds() {
          const offset = new spine.Vector2()
          const size = new spine.Vector2()
          skeleton.getBounds(offset, size, [])
          return { x: offset.x, y: offset.y, width: size.x, height: size.y }
        },
        updateWorldTransform: () => skeleton.updateWorldTransform(spine.Physics.update),
        update(delta) {
          state.update(delta)
          state.apply(skeleton)
          skeleton.updateWorldTransform(spine.Physics.update)
        },
        draw: premultipliedAlpha => renderer.drawSkeleton(skeleton, premultipliedAlpha),
      }
    },
    createTexture(image) {
      const texture = new spine.GLTexture(context, image)
      backgroundTextures.add(texture)
      return {
        width: image.width,
        height: image.height,
        draw(x, y, width, height) {
          renderer.batcher.setBlendMode(spine.BlendMode.Normal, false)
          renderer.drawTexture(texture, x, y, width, height)
        },
        dispose() {
          if (backgroundTextures.delete(texture))
            texture.dispose()
        },
      }
    },
    resize: () => renderer.resize(spine.ResizeMode.Expand),
    begin() {
      context.gl.clearColor(0, 0, 0, 0)
      context.gl.clear(context.gl.COLOR_BUFFER_BIT)
      renderer.begin()
    },
    end: () => renderer.end(),
    advanceTime() {
      time.update()
      return time.delta
    },
    dispose() {
      disposed = true
      try {
        assets.dispose()
      }
      finally {
        try {
          renderer.dispose()
        }
        finally {
          for (const texture of backgroundTextures)
            texture.dispose()
          backgroundTextures.clear()
        }
      }
    },
  }, config.app, canvas)
}
