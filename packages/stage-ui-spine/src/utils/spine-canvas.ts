import type { AnimationStateData, OrthoCamera, Skeleton, TrackEntry } from '@esotericsoftware/spine-webgl'

import { errorMessageFrom } from '@moeru/std'

/** Track controls shared by AIRI's supported runtime versions. */
export type SpineTrack = Pick<TrackEntry, 'alpha' | 'loop' | 'mixDuration'> & {
  animation: { name: string } | null
}

/** The animation operations used by AIRI's idle and emotion tracks. */
export interface SpineAnimationState {
  data: Pick<AnimationStateData, 'defaultMix'>
  setAnimation: (track: number, name: string, loop: boolean) => SpineTrack
  setEmptyAnimation: (track: number, mix: number) => void
  addListener: (listener: { complete: (entry: SpineTrack) => void }) => void
  removeListener: (listener: { complete: (entry: SpineTrack) => void }) => void
}

/** A loaded model whose SDK objects stay inside their matching version adapter. */
export interface SpineModel extends Pick<Skeleton, 'x' | 'y' | 'scaleX' | 'scaleY' | 'setToSetupPose' | 'setSkinByName' | 'setSlotsToSetupPose'> {
  animationState: SpineAnimationState
  animations: { name: string, duration: number }[]
  skins: { name: string }[]
  defaultSkinName?: string
  hasSkin: (name: string) => boolean
  getBounds: () => { x: number, y: number, width: number, height: number }
  updateWorldTransform: () => void
  update: (delta: number) => void
  draw: (premultipliedAlpha: boolean) => void
}

/** A background texture tied to the canvas that created it. */
export interface SpineTexture {
  width: number
  height: number
  draw: (x: number, y: number, width: number, height: number) => void
  dispose: () => void
}

/** Asset loading shared by the scene and ZIP preview. */
export interface SpineAssets {
  /** SDK owner inspected by the validated ZIP-downloader workaround. */
  source: object
  loadBinary: (path: string) => void
  loadJson: (path: string) => void
  loadTextureAtlas: (path: string) => void
  isLoadingComplete: () => boolean
  hasErrors: () => boolean
  getErrors: () => Record<string, string>
}

/** Version-specific GPU and model operations, without cross-version SDK objects. */
export interface SpineCanvasBackend {
  assetManager: SpineAssets
  camera: Pick<OrthoCamera, 'position' | 'viewportWidth' | 'viewportHeight' | 'zoom' | 'update'>
  createModel: (skeletonPath: string, atlasPath: string, format: 'binary' | 'json', mix: number) => SpineModel
  createTexture: (image: HTMLImageElement) => SpineTexture
  resize: () => void
  begin: () => void
  end: () => void
  advanceTime: () => number
  dispose: () => void
}

/** Lifecycle callbacks used by both model views. */
export interface SpineCanvasApp {
  loadAssets?: (canvas: SpineCanvas) => void
  initialize?: (canvas: SpineCanvas) => void
  update?: (canvas: SpineCanvas, delta: number) => void
  render?: (canvas: SpineCanvas) => void
  error?: (canvas: SpineCanvas, errors: Record<string, string>) => void
  dispose?: () => void
}

/** One canvas setup, with lifecycle ownership retained by AIRI. */
export interface SpineCanvasConfig {
  app: SpineCanvasApp
  pathPrefix?: string
  webglConfig?: WebGLContextAttributes
}

/** Creates a canvas using one matching set of SDK constructors. */
export type SpineCanvasFactory = (canvas: HTMLCanvasElement, config: SpineCanvasConfig) => SpineCanvas

/**
 * Owns asset readiness and one cancellable frame loop for every supported SDK.
 * Disposal stops callbacks before releasing GPU assets, including while loading.
 */
export class SpineCanvas {
  private frame?: number
  private disposed = false
  private initialized = false

  private onContextLost = (event: Event) => {
    event.preventDefault()
    try {
      this.app.error?.(this, { context: 'WebGL context lost.' })
    }
    finally {
      this.dispose()
    }
  }

  constructor(private backend: SpineCanvasBackend, private app: SpineCanvasApp, private canvas: HTMLCanvasElement) {
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    try {
      app.loadAssets?.(this)
      if (!this.disposed)
        this.frame = requestAnimationFrame(() => this.tick())
    }
    catch (error) {
      if (this.disposed)
        throw error
      this.disposed = true
      canvas.removeEventListener('webglcontextlost', this.onContextLost)
      try {
        backend.dispose()
      }
      catch (disposeError) {
        throw new AggregateError([error, disposeError], 'Spine loading and cleanup failed.')
      }
      throw error
    }
  }

  get assetManager() { return this.backend.assetManager }
  get camera() { return this.backend.camera }
  get isDisposed() { return this.disposed }

  createModel(skeletonPath: string, atlasPath: string, format: 'binary' | 'json', mix = 0) {
    if (this.disposed)
      throw new Error('Cannot load a model on a disposed Spine canvas.')
    return this.backend.createModel(skeletonPath, atlasPath, format, mix)
  }

  createTexture(image: HTMLImageElement) {
    if (this.disposed)
      throw new Error('Cannot create a texture on a disposed Spine canvas.')
    return this.backend.createTexture(image)
  }

  begin() { this.backend.begin() }
  end() { this.backend.end() }

  private tick() {
    try {
      this.advanceFrame()
    }
    catch (error) {
      try {
        this.app.error?.(this, { runtime: errorMessageFrom(error) ?? 'Spine runtime failed.' })
      }
      finally {
        this.dispose()
      }
    }
  }

  private advanceFrame() {
    if (this.disposed)
      return
    if (!this.initialized) {
      if (!this.backend.assetManager.isLoadingComplete()) {
        this.frame = requestAnimationFrame(() => this.tick())
        return
      }
      if (this.backend.assetManager.hasErrors()) {
        try {
          this.app.error?.(this, this.backend.assetManager.getErrors())
        }
        finally {
          this.dispose()
        }
        return
      }
      this.initialized = true
      this.app.initialize?.(this)
    }
    if (this.disposed)
      return
    this.backend.resize()
    this.app.update?.(this, this.backend.advanceTime())
    if (this.disposed)
      return
    this.app.render?.(this)
    if (!this.disposed)
      this.frame = requestAnimationFrame(() => this.tick())
  }

  dispose() {
    if (this.disposed)
      return
    this.disposed = true
    if (this.frame !== undefined)
      cancelAnimationFrame(this.frame)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    try {
      this.backend.dispose()
    }
    finally {
      this.app.dispose?.()
    }
  }
}
