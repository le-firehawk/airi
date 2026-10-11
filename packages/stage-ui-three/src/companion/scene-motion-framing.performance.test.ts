import { performance } from 'node:perf_hooks'

import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, PerspectiveCamera, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { expect, it, vi } from 'vitest'

import { SceneMotionFraming } from './scene-motion-framing'

function fixture(count: number) {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(count * 3)
  const weights = new Float32Array(count * 4)
  const indices = new Uint16Array(count * 4)
  for (let i = 0; i < count; i++) {
    positions.set([Math.sin(i), (i % 100) / 50, Math.cos(i)], i * 3)
    weights.set([0.25, 0.25, 0.25, 0.25], i * 4)
    indices.set([0, 1, 2, 3], i * 4)
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  const bones = Array.from({ length: 4 }, () => new Bone())
  mesh.add(...bones)
  mesh.bind(new Skeleton(bones))
  const root = new Group().add(mesh)
  const camera = new PerspectiveCamera(50, 1, 0.01, 1000)
  camera.position.set(0, 1, 5)
  const adapter = new SceneMotionFraming('profile')
  const input = { modelId: 'profile', motionRevision: 0, cameraRevision: 0, manualControl: false, root, camera, anchorWorld: new Vector3(0, 1, 0), motionActive: true }
  return { adapter, input, mesh, bones }
}

// Full-mesh CPU skinning previously blocked the render loop at each active-motion sample.
// The deterministic work assertion survives hardware changes. Timings remain diagnostic evidence only.
it('limits deformation work per frame for geometry near the total sample budget', () => {
  const { adapter, input } = fixture(499_000)
  const vertices = vi.spyOn(SkinnedMesh.prototype, 'getVertexPosition')
  vi.useFakeTimers({ toFake: ['performance'] })
  try {
    let complete = false
    for (let frame = 0; frame < 2000; frame++) {
      vertices.mockClear()
      const result = adapter.tick({ ...input, nowMs: frame * (1000 / 60) })
      expect(vertices.mock.calls.length).toBeLessThanOrEqual(4096)
      if (result.status === 'applied') {
        complete = true
        break
      }
    }
    expect(complete).toBe(true)
  }
  finally {
    vertices.mockRestore()
    vi.useRealTimers()
  }
})

it.runIf(process.env.AIRI_PROFILE_FRAMING === 'true')('reports full-scan versus incremental frame cost and completion latency', () => {
  for (const count of [50_000, 250_000, 499_000]) {
    const { adapter, input, mesh } = fixture(count)
    input.root.updateMatrixWorld(true)
    const baseline: number[] = []
    for (let sample = 0; sample < 5; sample++) {
      const started = performance.now()
      mesh.computeBoundingBox()
      baseline.push(performance.now() - started)
    }
    const frames: number[] = []
    let completionFrame = -1
    for (let frame = 0; frame < 2000; frame++) {
      const started = performance.now()
      const result = adapter.tick({ ...input, nowMs: frame * (1000 / 60) })
      frames.push(performance.now() - started)
      if (result.status === 'applied') {
        completionFrame = frame
        break
      }
    }
    expect(completionFrame).toBeGreaterThan(0)
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    const sorted = [...frames].sort((a, b) => a - b)
    console.info(JSON.stringify({
      vertices: count,
      baselineMeanMs: mean(baseline),
      baselinePeakMs: Math.max(...baseline),
      incrementalMeanMs: mean(frames),
      incrementalPeakMs: Math.max(...frames),
      incrementalP95Ms: sorted[Math.floor(sorted.length * 0.95)],
      completionFrames: completionFrame + 1,
      firstSampleLatencyAt60FpsMs: completionFrame * (1000 / 60),
    }))
  }
}, 30_000)
