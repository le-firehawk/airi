import type { VRMCore } from '@pixiv/three-vrm-core'
import type { AnimationAction, Box3, Group } from 'three'

import type { MotionCatalog } from './catalog'
import type { MotionStageFrame, StageMotionPlan } from './stage-bounds'
import type { MotionControllerSnapshot, MotionMetadata, MotionPlayOptions, MotionPlayResult } from './types'

import { AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, Quaternion, Vector3 } from 'three'

import { builtinMotionMetadata, createMotionCatalog } from './catalog'
import { JointKinematics } from './joint-kinematics'
import { createBodyClip, measureRig } from './rig'
import { createStageMotionEnvelope, fitStageMotionView, planStageMotion, transformStageOffset } from './stage-bounds'

interface ClipEntry {
  clip: AnimationClip
  revision: number | undefined
}

interface QueuedMotion {
  id: string
  options: MotionPlayOptions
}

interface WeightFade {
  from: number
  to: number
  start: number
}

interface ActiveMotion {
  id: string
  sourceClip: AnimationClip
  action: AnimationAction
  idleAction?: AnimationAction
  elapsed: number
  deadline: number
  speed: number
  circleRadius: number | undefined
  stageRadius?: number
  strideLength?: number
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const selected = Number.isFinite(value) ? value! : fallback
  return Math.max(minimum, Math.min(maximum, selected))
}

/**
 * Owns one avatar's mixer, clip cache, request queue, and temporary movement group.
 * Replacement, stop, reset, and disposal invalidate pending playback loads. Idle selection has a separate request lifetime.
 * The caller updates this controller before VRM.update, which retains expression, gaze, and physics ownership.
 */
export class MotionController {
  readonly mixer: AnimationMixer
  readonly catalog: MotionCatalog
  private readonly stockClip: AnimationClip
  private readonly clips = new Map<string, ClipEntry>()
  private readonly retiring = new Map<AnimationAction, number>()
  private readonly fades = new Map<AnimationAction, WeightFade>()
  private readonly queued: QueuedMotion[] = []
  private readonly restPosition: Vector3
  private readonly restRotation: Quaternion
  private readonly targetPosition = new Vector3()
  private readonly targetRotation = new Quaternion()
  private readonly yawAxis = new Vector3(0, 1, 0)
  private readonly height: number
  private readonly forwardYaw: number
  private stage: MotionStageFrame | undefined
  private stageBounds: Box3 | undefined
  private stagePlan: StageMotionPlan | undefined
  private stageEnvelope: Box3 | undefined
  private stageTurn = 0
  private readonly stageReadyListeners = new Set<() => void>()
  private movementYaw = 0
  private yawVelocity = 0
  private active: ActiveMotion
  private idleId = 'default-idle'
  private idleClip: AnimationClip
  private loadingId: string | undefined
  private playbackRequest: AbortController | undefined
  private idleRequest: AbortController | undefined
  private error: string | undefined
  private disposed = false

  /** The movement group must be a dedicated parent of vrm.scene, below the user's placement group. */
  constructor(
    private readonly vrm: VRMCore,
    idleClip: AnimationClip,
    private readonly movementRoot: Group,
    catalog = createMotionCatalog(),
  ) {
    this.catalog = catalog
    this.stockClip = createBodyClip(idleClip, vrm)
    this.idleClip = this.stockClip
    this.height = measureRig(vrm).height
    this.restPosition = movementRoot.position.clone()
    this.restRotation = movementRoot.quaternion.clone()
    const forward = new JointKinematics(vrm).displacement(new Vector3(0, 0, 1)).applyQuaternion(vrm.scene.quaternion).applyQuaternion(this.restRotation)
    this.forwardYaw = Math.atan2(forward.x, forward.z)
    this.mixer = new AnimationMixer(vrm.scene)
    this.catalog.register({
      id: 'default-idle',
      name: 'Original idle',
      category: 'idle',
      duration: this.stockClip.duration,
      loop: true,
      source: 'builtin',
    }, () => {
      // The controller resolves this entry locally. The shared catalog never retains an avatar or its stock clip.
      throw new Error('The original idle belongs to its avatar controller.')
    })
    this.clips.set('default-idle', { clip: this.stockClip, revision: this.catalog.getRevision('default-idle') })
    const action = this.mixer.clipAction(this.stockClip).setLoop(LoopRepeat, Infinity).play()
    this.active = { id: this.idleId, sourceClip: this.stockClip, action, elapsed: 0, deadline: Infinity, speed: 1, circleRadius: undefined }
  }

  /** Returns a fresh snapshot. Callers cannot mutate controller state through its arrays. */
  get snapshot(): MotionControllerSnapshot {
    return {
      activeId: this.active.id,
      idleId: this.idleId,
      loadingId: this.loadingId,
      queuedIds: this.queued.map(request => request.id),
      cachedClipCount: this.clips.size,
      error: this.error,
    }
  }

  /** Framing stays fixed until both travel and its smooth return have reached the saved transform. */
  get stageMovementActive() {
    return this.active.circleRadius !== undefined || this.movementRoot.position.distanceToSquared(this.restPosition) > 0.00000001
      || Math.abs(this.movementYaw) > 0.0001 || Math.abs(this.yawVelocity) > 0.001
  }

  get stageBoundsReady() {
    return !this.disposed && !!this.stage && !!this.stageBounds
  }

  /** Reuses the complete load-time geometry box. Its world coordinates are converted before viewport admission. */
  setLoadedStageBounds(worldBounds: Box3) {
    if (this.disposed || !this.stage || worldBounds.isEmpty() || ![...worldBounds.min.toArray(), ...worldBounds.max.toArray()].every(Number.isFinite))
      return
    const root = this.stage.root
    root.updateWorldMatrix(true, false)
    if (!root.matrixWorld.elements.every(Number.isFinite) || root.matrixWorld.determinant() === 0)
      return
    const bounds = worldBounds.clone().applyMatrix4(root.matrixWorld.clone().invert())
    this.setStageFrame({ ...this.stage, bounds })
  }

  /** Returns a one-shot view proposal for an explicit user action. No model or camera state changes here. */
  suggestStageMotionView(maximumDistance = Infinity) {
    if (this.disposed || !this.stage || !this.stageBounds)
      return undefined
    const envelope = this.stageBounds.clone()
    let circleEnvelope: Box3 | undefined
    for (const metadata of builtinMotionMetadata) {
      const bounds = createStageMotionEnvelope(this.stageBounds, metadata, this.height)
      if (!bounds)
        return undefined
      envelope.union(bounds)
      if (metadata.rootMotion === 'circle')
        circleEnvelope = bounds
    }
    return circleEnvelope ? fitStageMotionView(this.stage, envelope, circleEnvelope, maximumDistance) : undefined
  }

  /** The scene updates this after camera changes. Only complete idle samples can establish the reference silhouette. */
  setStageFrame(frame: MotionStageFrame) {
    if (this.disposed)
      return
    this.stage = frame
    if (frame.bounds && this.active.deadline === Infinity && this.movementRoot.position.distanceToSquared(this.restPosition) < 0.00000001)
      this.stageBounds = this.stageBounds ? this.stageBounds.union(frame.bounds) : frame.bounds.clone()
    if (this.stageBounds) {
      for (const ready of this.stageReadyListeners)
        ready()
    }
    if (this.active.id === 'default-idle' && this.active.deadline === Infinity && !this.stageMovementActive && this.retiring.size === 0) {
      this.stageEnvelope = undefined
      this.stagePlan = undefined
    }
    if (this.active.deadline === Infinity && !this.stageEnvelope && this.active.id === 'default-idle')
      return
    const metadata = this.catalog.get(this.active.id)
    if (!metadata)
      return
    if (!this.admitToStage(metadata, this.active.stageRadius).accepted) {
      const idle = this.catalog.get(this.idleId)
      const envelope = idle && this.stageBounds && createStageMotionEnvelope(this.stageBounds, idle, this.height)
      const idlePlan = envelope ? planStageMotion(frame, envelope, false) : undefined
      if (!idlePlan) {
        // A selected imported idle can stop fitting after resize. The supplied idle preserves the user's existing view.
        this.idleId = 'default-idle'
        this.idleClip = this.stockClip
      }
      const error = this.error
      // A shrinking viewport cannot safely retain the outgoing pose for a crossfade.
      this.reset()
      this.error = error
      if (this.idleId !== 'default-idle') {
        this.stageEnvelope = envelope
        this.stagePlan = idlePlan
      }
    }
    this.clampMovementToStage()
  }

  /** Resolves true when playback starts or a request enters the queue. Stale or invalid requests resolve false. */
  async play(id: string, options: MotionPlayOptions = {}): Promise<boolean> {
    return (await this.playResult(id, options)).accepted
  }

  /** Returns this request's admission result. Later requests, idle loads, and snapshot errors cannot change its reason. */
  async playResult(id: string, options: MotionPlayOptions = {}): Promise<MotionPlayResult> {
    if (this.disposed)
      return { accepted: false, reason: 'not-ready' }
    const metadata = this.catalog.get(id)
    if (!metadata) {
      this.error = `Motion "${id}" is not registered.`
      return { accepted: false, reason: 'unavailable' }
    }
    if (options.mode === 'queue' && (this.loadingId || this.active.deadline !== Infinity)) {
      if (this.queued.length >= 16) {
        this.error = 'The motion queue is full. Stop playback to clear it.'
        return { accepted: false, reason: 'queue-full' }
      }
      this.queued.push({ id, options: { ...options, mode: 'replace' } })
      return { accepted: true }
    }
    if (options.mode !== 'queue')
      this.queued.length = 0
    return this.start(id, options, metadata)
  }

  /** Selects a looping idle without interrupting an active gesture. Failed loads keep the current idle. */
  async setIdle(id: string): Promise<boolean> {
    if (this.disposed)
      return false
    const metadata = this.catalog.get(id)
    if (!metadata || metadata.rootMotion || (metadata.category !== 'idle' && metadata.source !== 'imported')) {
      this.error = `Motion "${id}" is not an idle.`
      return false
    }
    this.idleRequest?.abort()
    const request = new AbortController()
    this.idleRequest = request
    try {
      const clip = await this.loadClip(id, request.signal)
      if (request.signal.aborted || this.disposed)
        return false
      if (id === 'default-idle' && id === this.idleId && clip === this.idleClip) {
        this.error = undefined
        return true
      }
      // The host restores its saved idle before the first mesh sample. Keep that selection pending until bounds arrive.
      if (!await this.waitForStageBounds(request.signal) || request.signal.aborted || this.disposed)
        return false
      if (this.clips.get(id)?.revision !== this.catalog.getRevision(id))
        return false
      if (!this.admitToStage(metadata, undefined, this.active.deadline === Infinity).accepted)
        return false
      if (id === this.idleId && clip === this.idleClip) {
        this.error = undefined
        return true
      }
      const wasIdle = this.active.deadline === Infinity
      const previousIdleClip = this.idleClip
      this.idleId = id
      this.idleClip = clip
      this.error = undefined
      if (wasIdle) {
        this.returnToIdle()
      }
      else {
        const previousIdle = this.active.idleAction
        if (previousIdle)
          this.retire(previousIdle, false)
        this.active.idleAction = this.createIdleCompanion(this.active.sourceClip, false)
        if (previousIdle)
          this.releaseUnusedClip(previousIdle.getClip())
        this.fade(this.active.action, 1, false)
        this.retimeRetiringActions()
        this.trimRetiringActions()
      }
      this.releaseUnusedClip(previousIdleClip)
      return true
    }
    catch {
      if (!request.signal.aborted && !this.disposed)
        this.error = `Idle "${id}" failed to load.`
      return false
    }
    finally {
      if (this.idleRequest === request)
        this.idleRequest = undefined
    }
  }

  /** Clears queued and pending requests, then blends the body and movement back to the selected idle. */
  stop() {
    if (this.disposed)
      return
    this.cancelRequests()
    this.returnToIdle()
  }

  /** Resets immediately for an invisible, detached avatar. Visible stop operations use stop(). */
  reset() {
    if (this.disposed)
      return
    this.cancelRequests()
    this.mixer.stopAllAction()
    this.fades.clear()
    for (const action of this.retiring.keys()) {
      this.retiring.delete(action)
      this.releaseUnusedClip(action.getClip())
    }
    this.movementRoot.position.copy(this.restPosition)
    this.movementRoot.quaternion.copy(this.restRotation)
    this.movementYaw = 0
    this.yawVelocity = 0
    this.stageEnvelope = undefined
    this.stagePlan = undefined
    this.stageTurn = 0
    this.returnToIdle(true)
    this.mixer.update(0)
    this.trimCache()
  }

  /** Advances playback in seconds. Long frame gaps still count toward the finite action deadline. */
  update(delta: number) {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0)
      return
    const step = Math.min(delta, 0.1)
    this.active.elapsed += delta
    // Clip time follows elapsed time. Only movement smoothing needs a bounded integration step.
    this.updateFades(this.mixer.time + delta)
    this.mixer.update(delta)
    for (const [action, deadline] of this.retiring) {
      if (this.mixer.time >= deadline) {
        action.stop()
        this.fades.delete(action)
        this.retiring.delete(action)
        this.releaseUnusedClip(action.getClip())
      }
    }
    if (this.active.elapsed >= this.active.deadline) {
      // A replacement load owns the next turn. Queued requests wait until that replacement finishes.
      if (this.loadingId)
        this.returnToIdle()
      else
        this.advanceQueue()
    }
    this.updateMovement(step)
    this.trimCache()
  }

  /** Cancels pending work, releases mixer bindings, and restores the movement group's initial transform. */
  dispose() {
    if (this.disposed)
      return
    this.cancelRequests()
    this.disposed = true
    this.mixer.stopAllAction()
    this.fades.clear()
    this.mixer.uncacheRoot(this.vrm.scene)
    this.clips.clear()
    for (const action of this.retiring.keys()) {
      this.retiring.delete(action)
      this.releaseUnusedClip(action.getClip())
    }
    this.movementRoot.position.copy(this.restPosition)
    this.movementRoot.quaternion.copy(this.restRotation)
    this.movementYaw = 0
    this.yawVelocity = 0
  }

  private cancelRequests() {
    this.playbackRequest?.abort()
    this.idleRequest?.abort()
    this.playbackRequest = undefined
    this.idleRequest = undefined
    this.loadingId = undefined
    this.queued.length = 0
    this.error = undefined
  }

  private async loadClip(id: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const revision = this.catalog.getRevision(id)
    const cached = this.clips.get(id)
    if (cached && cached.revision === revision) {
      this.clips.delete(id)
      this.clips.set(id, cached)
      return cached.clip
    }
    const source = id === 'default-idle' ? this.stockClip : await this.catalog.load(id, this.vrm, signal)
    signal.throwIfAborted()
    if (this.disposed || revision !== this.catalog.getRevision(id))
      throw new Error('The motion changed before its load completed.')
    const clip = id === 'default-idle' ? this.stockClip : createBodyClip(source, this.vrm)
    this.clips.set(id, { clip, revision })
    if (cached && cached.clip !== clip)
      this.releaseUnusedClip(cached.clip)
    this.trimCache(id)
    return clip
  }

  private async start(id: string, options: MotionPlayOptions, metadata: Readonly<MotionMetadata>): Promise<MotionPlayResult> {
    this.playbackRequest?.abort()
    const request = new AbortController()
    this.playbackRequest = request
    this.loadingId = id
    this.error = undefined
    try {
      const clip = await this.loadClip(id, request.signal)
      if (request.signal.aborted || this.disposed)
        return { accepted: false, reason: 'cancelled' }
      const stageRadius = options.radius === undefined ? undefined : bounded(options.radius, this.height * 0.12, 0, this.height * 2)
      const admission = this.admitToStage(metadata, stageRadius)
      if (!admission.accepted) {
        // Queue admission uses the current viewport after loading, not the size when the item was enqueued.
        this.queued.length = 0
        return admission
      }
      const speed = bounded(options.speed, 1, 0.25, 2)
      const loop = options.loop ?? metadata.loop
      const requestedDeadline = bounded(options.duration, loop ? 15 : clip.duration / speed, 0.1, 60)
      const deadline = loop ? requestedDeadline : Math.min(requestedDeadline, clip.duration / speed)
      const circleRadius = metadata.rootMotion === 'circle'
        ? bounded(options.radius, this.height * 0.12, 0, this.height * 0.2)
        : undefined
      this.transition(id, clip, loop, speed, deadline, circleRadius)
      this.active.stageRadius = stageRadius
      this.active.strideLength = bounded(metadata.strideLength, 0.44, 0.05, 0.8)
      this.stageTurn = 0
      return { accepted: true }
    }
    catch {
      const result: MotionPlayResult = { accepted: false, reason: request.signal.aborted || this.disposed ? 'cancelled' : 'load-failed' }
      if (!request.signal.aborted && !this.disposed) {
        this.error = `Motion "${id}" failed to load.`
        // A failed queued motion cannot strand later requests or suppress the idle.
        this.advanceQueue()
      }
      return result
    }
    finally {
      if (this.playbackRequest === request) {
        this.playbackRequest = undefined
        this.loadingId = undefined
      }
    }
  }

  private transition(id: string, clip: AnimationClip, loop: boolean, speed: number, deadline: number, circleRadius?: number, immediate = false) {
    let next = this.mixer.clipAction(clip)
    const previous = this.active
    // A live motion keeps its pose while a separate playback instance restarts the same immutable tracks.
    if (deadline !== Infinity && next.isScheduled() && next.getEffectiveWeight() > 0)
      next = this.mixer.clipAction(new AnimationClip(clip.name, clip.duration, clip.tracks))
    const initialWeight = next.isScheduled() ? next.getEffectiveWeight() : 0
    this.retiring.delete(next)
    if (previous.action !== next)
      this.retire(previous.action, immediate)
    if (previous.idleAction)
      this.retire(previous.idleAction, immediate)
    next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(initialWeight).setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
    next.clampWhenFinished = true
    if (deadline === Infinity)
      next.time = this.mixer.time % clip.duration
    next.play()
    this.fade(next, 1, immediate)
    const idleAction = this.createIdleCompanion(clip, immediate)
    this.active = { id, sourceClip: clip, action: next, idleAction, elapsed: 0, deadline, speed, circleRadius }
    if (previous.action !== next)
      this.releaseUnusedClip(previous.action.getClip())
    if (previous.idleAction)
      this.releaseUnusedClip(previous.idleAction.getClip())
    this.retimeRetiringActions()
    this.trimRetiringActions()
  }

  private createIdleCompanion(clip: AnimationClip, immediate: boolean) {
    const ownedTracks = new Set(clip.tracks.map(track => track.name))
    const tracks = this.idleClip.tracks.filter(track => !ownedTracks.has(track.name))
    if (tracks.length === 0)
      return undefined
    // Disjoint track sets preserve idle movement without diluting the motion on its owned bones.
    // Tracks stay immutable. Only this temporary clip and its mixer bindings need separate ownership.
    const mask = new AnimationClip('masked-idle', this.idleClip.duration, tracks)
    const action = this.mixer.clipAction(mask).setLoop(LoopRepeat, Infinity).setEffectiveTimeScale(1).setEffectiveWeight(0)
    action.time = this.mixer.time % this.idleClip.duration
    action.play()
    this.fade(action, 1, immediate)
    return action
  }

  private retire(action: AnimationAction, immediate: boolean) {
    if (immediate || action.getEffectiveWeight() === 0) {
      action.stop()
      this.fades.delete(action)
      this.retiring.delete(action)
      return
    }
    this.fade(action, 0, false)
    this.retiring.set(action, this.mixer.time + 0.3)
  }

  private fade(action: AnimationAction, to: number, immediate: boolean) {
    if (immediate) {
      action.setEffectiveWeight(to)
      this.fades.delete(action)
      return
    }
    this.fades.set(action, { from: action.getEffectiveWeight(), to, start: this.mixer.time })
  }

  private updateFades(time: number) {
    for (const [action, fade] of this.fades) {
      const progress = Math.min(1, Math.max(0, (time - fade.start) / 0.3))
      action.setEffectiveWeight(fade.from + (fade.to - fade.from) * progress)
      if (progress === 1)
        this.fades.delete(action)
    }
  }

  private retimeRetiringActions() {
    // Matching fade deadlines preserve the per-track weight sum when a new transition interrupts an earlier blend.
    for (const action of this.retiring.keys()) {
      this.fade(action, 0, false)
      this.retiring.set(action, this.mixer.time + 0.3)
    }
  }

  private trimRetiringActions() {
    // Each transition can retire a motion and a masked idle. Rapid replacement retains at most four such pairs.
    while (this.retiring.size > 8) {
      const oldest = this.retiring.keys().next().value
      if (!oldest)
        break
      oldest.stop()
      this.fades.delete(oldest)
      this.retiring.delete(oldest)
      this.releaseUnusedClip(oldest.getClip())
    }
  }

  private returnToIdle(immediate = false) {
    this.transition(this.idleId, this.idleClip, true, 1, Infinity, undefined, immediate)
  }

  private advanceQueue() {
    this.returnToIdle()
    const next = this.queued.shift()
    if (!next)
      return
    const metadata = this.catalog.get(next.id)
    if (!metadata) {
      this.error = `Motion "${next.id}" is no longer registered.`
      this.advanceQueue()
      return
    }
    void this.start(next.id, next.options, metadata)
  }

  private admitToStage(metadata: Readonly<MotionMetadata>, radius?: number, commit = true): MotionPlayResult {
    if (!this.stage)
      return { accepted: true }
    if (this.stage.manualControl) {
      this.error = 'Finish adjusting the camera before starting a motion.'
      return { accepted: false, reason: 'manual-camera' }
    }
    if (!this.stageBounds) {
      this.error = 'The stage is preparing model bounds. Try the motion again when the model is ready.'
      return { accepted: false, reason: 'not-ready' }
    }
    const envelope = createStageMotionEnvelope(this.stageBounds, metadata, this.height)
    if (envelope && this.stageEnvelope && (this.retiring.size > 0 || Math.abs(this.movementYaw) > 0.0001))
      envelope.union(this.stageEnvelope)
    const plan = envelope && planStageMotion(this.stage, envelope, metadata.rootMotion === 'circle', radius)
    if (!plan) {
      this.error = 'This motion needs more room. Enlarge the model window or zoom out, then try again.'
      return { accepted: false, reason: 'insufficient-room' }
    }
    if (commit) {
      this.stageEnvelope = envelope
      this.stagePlan = plan
    }
    return { accepted: true }
  }

  private waitForStageBounds(signal: AbortSignal): Promise<boolean> {
    if (!this.stage || this.stageBounds)
      return Promise.resolve(true)
    return new Promise((resolve) => {
      let abort: () => void
      let readyListener: () => void
      const finish = (ready: boolean) => {
        signal.removeEventListener('abort', abort)
        this.stageReadyListeners.delete(readyListener)
        resolve(ready)
      }
      abort = () => finish(false)
      readyListener = () => finish(true)
      this.stageReadyListeners.add(readyListener)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted)
        abort()
    })
  }

  private clampMovementToStage() {
    const plan = this.stagePlan
    if (!plan)
      return
    const offset = transformStageOffset(this.movementRoot.position.clone().sub(this.restPosition), plan.parentToCamera)
    offset.x = Math.max(plan.minimum.x, Math.min(plan.maximum.x, offset.x))
    offset.y = Math.max(plan.minimum.y, Math.min(plan.maximum.y, offset.y))
    offset.z = 0
    transformStageOffset(offset, plan.cameraToParent)
    this.movementRoot.position.copy(this.restPosition).add(offset)
  }

  private updateMovement(delta: number) {
    this.targetPosition.copy(this.restPosition)
    let targetYaw = 0
    if (this.active.circleRadius !== undefined && this.stagePlan && this.stage) {
      const plan = this.stagePlan
      const radiusX = plan.radius.x
      const radiusY = plan.radius.y
      const phase = this.stageTurn
      const direction = Math.sign(plan.center.x)
      const pathSpeed = transformStageOffset(new Vector3(direction * radiusX * Math.sin(phase), -radiusY * Math.cos(phase), 0), plan.cameraToParent).length()
      // Distance follows gait cadence. Larger stages create larger paths rather than faster sliding feet.
      const strideSpeed = this.height * (this.active.strideLength ?? 0.44) / this.active.sourceClip.duration * this.active.speed
      this.stageTurn += Math.min(Math.PI, strideSpeed / Math.max(this.height * 0.05, pathSpeed)) * delta
      this.targetPosition.set(plan.center.x - direction * Math.cos(this.stageTurn) * radiusX, plan.center.y - Math.sin(this.stageTurn) * radiusY, 0)
      transformStageOffset(this.targetPosition, plan.cameraToParent).add(this.restPosition)
      // Screen up represents the far side of the stage. Heading follows the ellipse's tangent, not its phase alone.
      const heading = transformStageOffset(new Vector3(direction * radiusX * Math.sin(this.stageTurn), 0, radiusY * Math.cos(this.stageTurn)), plan.cameraToParent)
      targetYaw = Math.atan2(heading.x, heading.z) - this.forwardYaw
    }
    else if (this.active.circleRadius !== undefined && !this.stage) {
      const elapsed = this.active.elapsed
      // The unbound preview keeps the reference running turn rate and scales other gaits by their travel cadence.
      const cadence = (this.active.strideLength ?? 0.44) / 0.44 * 0.72 / this.active.sourceClip.duration
      const turn = elapsed * this.active.speed * Math.PI / 2 * cadence
      const entry = Math.min(1, elapsed / 0.6)
      const radius = this.active.circleRadius * entry * entry * (3 - 2 * entry)
      // The circle starts with its tangent along the avatar's rest heading, without an initial quarter-turn target.
      this.targetPosition.set(-Math.cos(turn) * radius, 0, Math.sin(turn) * radius).applyQuaternion(this.restRotation).add(this.restPosition)
      targetYaw = turn
    }
    const blend = 1 - Math.exp(-10 * delta)
    this.movementRoot.position.lerp(this.targetPosition, blend)
    this.clampMovementToStage()

    // Signed velocity bounds both turns and direction changes, including a return from the opposite heading.
    const maximumSpeed = Math.PI
    const maximumAcceleration = Math.PI * 3
    const error = Math.atan2(Math.sin(targetYaw - this.movementYaw), Math.cos(targetYaw - this.movementYaw))
    const brakingSpeed = Math.sqrt(2 * maximumAcceleration * Math.abs(error))
    const desiredVelocity = Math.sign(error) * Math.min(maximumSpeed, Math.abs(error) * 10, brakingSpeed)
    const accelerationStep = maximumAcceleration * delta
    this.yawVelocity += Math.max(-accelerationStep, Math.min(accelerationStep, desiredVelocity - this.yawVelocity))
    this.movementYaw += this.yawVelocity * delta
    this.targetRotation.setFromAxisAngle(this.yawAxis, this.movementYaw).premultiply(this.restRotation)
    this.movementRoot.quaternion.copy(this.targetRotation)

    if (this.active.circleRadius === undefined && this.movementRoot.position.distanceToSquared(this.restPosition) < 0.00000001)
      this.movementRoot.position.copy(this.restPosition)
    if (this.active.circleRadius === undefined && Math.abs(error) < 0.0001 && Math.abs(this.yawVelocity) < 0.001) {
      this.movementRoot.quaternion.copy(this.restRotation)
      this.movementYaw = 0
      this.yawVelocity = 0
    }
  }

  private releaseUnusedClip(clip: AnimationClip) {
    if (clip === this.idleClip || clip === this.active.action.getClip() || clip === this.active.idleAction?.getClip())
      return
    if ([...this.retiring.keys()].some(action => action.getClip() === clip))
      return
    if ([...this.clips.values()].some(entry => entry.clip === clip))
      return
    this.mixer.uncacheClip(clip)
  }

  private trimCache(protectedId?: string) {
    for (const [id, entry] of this.clips) {
      if (this.clips.size <= 8)
        break
      if (id === protectedId || entry.clip === this.idleClip || entry.clip === this.active.sourceClip)
        continue
      const action = this.mixer.existingAction(entry.clip)
      if (action) {
        action.stop()
        this.fades.delete(action)
        this.retiring.delete(action)
        this.releaseUnusedClip(action.getClip())
      }
      this.mixer.uncacheClip(entry.clip)
      this.clips.delete(id)
    }
  }
}
