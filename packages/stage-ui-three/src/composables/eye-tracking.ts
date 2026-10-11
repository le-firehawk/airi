import type { VRMLookAt } from '@pixiv/three-vrm-core'
import type { PerspectiveCamera, Raycaster } from 'three'
import type { MaybeRefOrGetter } from 'vue'

import type { TrackingMode, Vec3 } from '../stores/model-store'

import { Object3D, Vector2, Vector3 } from 'three'
import { toValue } from 'vue'

interface VRMWorldContext {
  raycaster: Raycaster
  camera: PerspectiveCamera
  defaultLookAt: Vector3
  lookAtOrigin: Vector3
}

export interface VRMEyeFocusSource {
  x: number
  y: number
}

/**
 * Resolves a world-space gaze target each frame, including camera and animated head transforms.
 * Source coordinates and scene bounds share the browser viewport or Electron window coordinate space.
 * The returned getter reuses its vector. Copy the vector before keeping it across calls.
 */
export function useVRMEyeFocusFor(options: {
  cameraPosition: MaybeRefOrGetter<Vec3>
  context: MaybeRefOrGetter<VRMWorldContext>
  screenBoundingBox: MaybeRefOrGetter<{ top: number, left: number, height: number, width: number }>
  source: MaybeRefOrGetter<VRMEyeFocusSource | null | undefined>
  trackingMode: MaybeRefOrGetter<TrackingMode>
}) {
  const focus = new Vector3()
  const forward = new Vector3()
  const cameraPosition = new Vector3()
  const pointer = new Vector2()

  return () => {
    const trackingMode = toValue(options.trackingMode)
    if (trackingMode === 'camera')
      return focus.copy(toValue(options.cameraPosition))

    const ctx = toValue(options.context)
    const source = toValue(options.source)
    if (trackingMode === 'none' || !source)
      return ctx.defaultLookAt

    const screen = toValue(options.screenBoundingBox)
    if (screen.width <= 0 || screen.height <= 0 || !Number.isFinite(source.x) || !Number.isFinite(source.y))
      return ctx.defaultLookAt

    pointer.set(
      ((source.x - screen.left) / screen.width) * 2 - 1,
      -((source.y - screen.top) / screen.height) * 2 + 1,
    )
    ctx.camera.updateWorldMatrix(true, false)
    ctx.raycaster.setFromCamera(pointer, ctx.camera)
    ctx.camera.getWorldDirection(forward)
    ctx.camera.getWorldPosition(cameraPosition)
    const distance = Math.max(cameraPosition.distanceTo(ctx.lookAtOrigin), 0.1)

    // Place the gaze plane in front of the eyes, facing the camera.
    // Camera-relative offsets preserve both axes without tying gaze range to the camera clipping plane.
    const rayDistance = distance / ctx.raycaster.ray.direction.dot(forward)
    return focus.copy(ctx.lookAtOrigin)
      .addScaledVector(ctx.raycaster.ray.direction, rayDistance)
      .addScaledVector(forward, -2 * distance)
  }
}

/**
 * Smooths gaze in world space. The render loop owns the subsequent VRMLookAt.update call.
 * Each model retains its own target, including any existing target parent.
 */
export class VRMEyeFocus {
  private readonly worldPosition = new Vector3()

  update(lookAt: VRMLookAt | undefined, destination: Vec3, delta: number) {
    if (!lookAt)
      return
    if (!lookAt.target) {
      lookAt.target = new Object3D()
      lookAt.target.position.copy(destination)
      return
    }
    if (!Number.isFinite(delta) || delta <= 0)
      return

    // A 50 ms time constant gives the same response at different render rates.
    const blend = -Math.expm1(-20 * delta)
    lookAt.target.getWorldPosition(this.worldPosition)
    this.worldPosition.lerp(destination, blend)
    if (lookAt.target.parent)
      lookAt.target.parent.worldToLocal(this.worldPosition)
    lookAt.target.position.copy(this.worldPosition)
  }
}
