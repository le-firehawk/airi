import type { VRMCore } from '@pixiv/three-vrm-core'
import type { AnimationClip } from 'three'

/** Metadata stays small. Browsing the catalog never loads animation assets. */
export interface MotionMetadata {
  id: string
  name: string
  description?: string
  tags?: readonly string[]
  category: 'idle' | 'gesture' | 'dance' | 'locomotion'
  duration: number
  loop: boolean
  source: 'builtin' | 'imported'
  rootMotion?: 'circle'
}

/** Loaders retarget to this avatar. Aborted results never enter its mixer or cache. */
export type MotionLoader = (vrm: VRMCore, signal: AbortSignal) => AnimationClip | Promise<AnimationClip>

/** Options affect one request. Repeated actions have a finite playback deadline. */
export interface MotionPlayOptions {
  /** @default 'replace' */
  mode?: 'replace' | 'queue'
  /** @default The catalog entry's loop value. */
  loop?: boolean
  /** Playback rate, clamped from 0.25 to 2. @default 1 */
  speed?: number
  /** Seconds, capped at 60. @default 15 for loops, otherwise the clip duration. */
  duration?: number
  /** Radius limit in scene units. A bound stage uses its available space by default. Headless playback defaults to 12% of avatar height. */
  radius?: number
}

/** A fresh, detached view of one avatar's current playback state. */
export interface MotionControllerSnapshot {
  activeId: string
  idleId: string
  loadingId: string | undefined
  queuedIds: string[]
  /** Counts cached source clips. Bounded temporary masks and transition instances are excluded. */
  cachedClipCount: number
  error: string | undefined
}

/** An explicit fit request changes the view only when the loaded stage has enough usable pixels. */
export type MotionStageFitResult = 'applied' | 'not-ready' | 'insufficient-room'
