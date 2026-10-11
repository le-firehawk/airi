import type { Box3, Matrix4, Object3D, PerspectiveCamera } from 'three'

import type { MotionMetadata } from './types'

import { Quaternion, Vector2, Vector3 } from 'three'

import { solvePerspectiveFraming } from '../companion/motion-framing'

/** The scene supplies CSS pixels and a complete idle mesh sample in placement-parent coordinates. */
export interface MotionStageFrame {
  camera: PerspectiveCamera
  root: Object3D
  width: number
  height: number
  manualControl: boolean
  bounds?: Box3
}

/** Legal root translations are measured along the current camera's right and up axes. */
export interface StageMotionPlan {
  minimum: Vector2
  maximum: Vector2
  center: Vector2
  radius: Vector2
  cameraToParent: Matrix4
  parentToCamera: Matrix4
  pixelScale: Vector2
}

function finiteBounds(bounds: Box3) {
  return !bounds.isEmpty() && [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
}

/** Reserves conservative limb and costume clearance. Secondary physics can exceed this estimated envelope. */
export function createStageMotionEnvelope(bounds: Box3, metadata: Readonly<MotionMetadata>, height: number): Box3 | undefined {
  if (!finiteBounds(bounds) || !Number.isFinite(height) || height <= 0)
    return undefined
  const envelope = bounds.clone()
  if (metadata.source === 'imported') {
    // Imported clips can articulate any supported bone. Their wider clearance includes the sanitized hips-translation limit.
    envelope.expandByVector(new Vector3(height * 1.2, height * 1.25, height * 1.2))
  }
  else if (metadata.rootMotion === 'circle') {
    // A full turn includes the depth of clothing and accessories in the horizontal silhouette.
    const radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)))
    envelope.min.x = envelope.min.z = -radius - height * 0.12
    envelope.max.x = envelope.max.z = radius + height * 0.12
    envelope.min.y -= height * 0.04
    envelope.max.y += height * 0.04
  }
  else if (metadata.id === 'nod' || metadata.id === 'shake-head' || metadata.category === 'idle') {
    envelope.expandByScalar(height * 0.035)
  }
  else if (metadata.id === 'bow') {
    envelope.expandByVector(new Vector3(height * 0.08, height * 0.05, height * 0.35))
  }
  else {
    envelope.expandByVector(new Vector3(height * 0.3, height * 0.22, height * 0.2))
  }
  return envelope
}

/** Intersects all envelope corners with the inset frustum. This performs constant work and never changes the camera. */
export function planStageMotion(frame: MotionStageFrame, envelope: Box3, circle: boolean, radiusLimit?: number): StageMotionPlan | undefined {
  const { camera, root, width, height } = frame
  if (!finiteBounds(envelope) || ![width, height].every(value => Number.isFinite(value) && value >= 64)
    || camera.view?.enabled || camera.filmOffset !== 0) {
    return undefined
  }
  camera.updateWorldMatrix(true, false)
  root.updateWorldMatrix(true, false)
  const parentToCamera = camera.matrixWorldInverse.clone().multiply(root.matrixWorld)
  const cameraToParent = root.matrixWorld.clone().invert().multiply(camera.matrixWorld)
  if (![...parentToCamera.elements, ...cameraToParent.elements].every(Number.isFinite)
    || parentToCamera.determinant() === 0 || cameraToParent.determinant() === 0) {
    return undefined
  }
  const tanY = Math.tan(camera.fov * Math.PI / 360) / camera.zoom
  const tanX = tanY * camera.aspect
  if (![tanX, tanY].every(value => Number.isFinite(value) && value > 0))
    return undefined
  const insetX = 1 - Math.min(0.25, 24 / width)
  const insetY = 1 - Math.min(0.25, 24 / height)
  const minimum = new Vector2(-Infinity, -Infinity)
  const maximum = new Vector2(Infinity, Infinity)
  const point = new Vector3()
  let nearestDepth = Infinity
  for (const x of [envelope.min.x, envelope.max.x]) {
    for (const y of [envelope.min.y, envelope.max.y]) {
      for (const z of [envelope.min.z, envelope.max.z]) {
        point.set(x, y, z).applyMatrix4(parentToCamera)
        const depth = -point.z
        if (depth <= camera.near || depth >= camera.far)
          return undefined
        nearestDepth = Math.min(nearestDepth, depth)
        minimum.x = Math.max(minimum.x, -depth * tanX * insetX - point.x)
        maximum.x = Math.min(maximum.x, depth * tanX * insetX - point.x)
        minimum.y = Math.max(minimum.y, -depth * tanY * insetY - point.y)
        maximum.y = Math.min(maximum.y, depth * tanY * insetY - point.y)
      }
    }
  }
  // The saved placement and the whole path must fit. Playback cannot recenter a user's cropped composition.
  if (minimum.x > 0 || minimum.y > 0 || maximum.x < 0 || maximum.y < 0)
    return undefined
  const direction = maximum.x >= -minimum.x ? 1 : -1
  const radius = new Vector2(Math.max(maximum.x, -minimum.x) * 0.45, Math.min(maximum.y, -minimum.y) * 0.9)
  if (radiusLimit !== undefined) {
    const horizontalScale = transformStageOffset(new Vector3(1, 0, 0), cameraToParent).length()
    const verticalScale = transformStageOffset(new Vector3(0, 1, 0), cameraToParent).length()
    radius.x = Math.min(radius.x, radiusLimit / horizontalScale)
    radius.y = Math.min(radius.y, radiusLimit / verticalScale)
  }
  // Start the ellipse at the saved placement. This removes a lateral slide from the origin to a distant path edge.
  const center = new Vector2(direction * radius.x, 0)
  const pixelScale = new Vector2(width / (2 * nearestDepth * tanX), height / (2 * nearestDepth * tanY))
  if (circle && (radius.x * pixelScale.x < 24 || radius.y * pixelScale.y < 16))
    return undefined
  return { minimum, maximum, center, radius, cameraToParent, parentToCamera, pixelScale }
}

/** Transforms a displacement without applying matrix translation or normalizing away its distance. */
export function transformStageOffset(offset: Vector3, matrix: Matrix4) {
  const e = matrix.elements
  const { x, y, z } = offset
  return offset.set(e[0]! * x + e[4]! * y + e[8]! * z, e[1]! * x + e[5]! * y + e[9]! * z, e[2]! * x + e[6]! * y + e[10]! * z)
}

/** Proposes one explicit full-body view. It preserves the lens and orientation and verifies usable circle clearance before returning. */
export function fitStageMotionView(frame: MotionStageFrame, envelope: Box3, circleEnvelope: Box3, maximumDistance = Infinity) {
  if (!finiteBounds(envelope) || !finiteBounds(circleEnvelope) || frame.manualControl)
    return undefined
  frame.root.updateWorldMatrix(true, false)
  frame.camera.updateWorldMatrix(true, false)
  const worldBounds = envelope.clone().applyMatrix4(frame.root.matrixWorld)
  const target = worldBounds.getCenter(new Vector3())
  const orientation = frame.camera.getWorldQuaternion(new Quaternion())
  const backward = new Vector3(0, 0, 1).applyQuaternion(orientation)
  const candidate = frame.camera.clone()
  candidate.quaternion.copy(orientation)
  candidate.position.copy(target).addScaledVector(backward, Math.max(frame.camera.near * 2, worldBounds.getSize(new Vector3()).length()))
  candidate.updateWorldMatrix(true, false)
  const cameraBounds = envelope.clone().applyMatrix4(candidate.matrixWorldInverse.clone().multiply(frame.root.matrixWorld))
  const solution = solvePerspectiveFraming({
    bounds: cameraBounds,
    anchor: target.clone().applyMatrix4(candidate.matrixWorldInverse),
    lens: { verticalFovDegrees: candidate.fov, aspect: candidate.aspect, zoom: candidate.zoom, near: candidate.near, far: candidate.far },
    margin: 0.35,
    maxZoomOut: 8,
  })
  if (!solution?.fits)
    return undefined
  candidate.position.copy(solution.cameraOffset.clone().applyMatrix4(candidate.matrixWorld))
  const distance = candidate.position.distanceTo(target)
  if (distance > maximumDistance)
    candidate.position.copy(target).addScaledVector(backward, maximumDistance)
  candidate.updateWorldMatrix(true, false)
  const proposed = { ...frame, camera: candidate }
  if (!planStageMotion(proposed, envelope, false) || !planStageMotion(proposed, circleEnvelope, true))
    return undefined
  return { position: candidate.position.clone(), target, distance: candidate.position.distanceTo(target) }
}
