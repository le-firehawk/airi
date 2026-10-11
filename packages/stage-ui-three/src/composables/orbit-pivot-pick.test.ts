import type { OrbitPickScheduler } from './orbit-pivot-pick'

import { Bone, BoxGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { pickModelOrbitPivot } from './orbit-pivot'
import { OrbitPivotPicker } from './orbit-pivot-pick'

const rect = { left: 0, top: 0, width: 400, height: 400 }
const center = { x: 200, y: 200 }

function setup() {
  const frames: (() => void)[] = []
  const tasks: (() => void)[] = []
  function enqueue(queue: (() => void)[], callback: () => void) {
    queue.push(callback)
    return () => {
      const index = queue.indexOf(callback)
      if (index >= 0)
        queue.splice(index, 1)
    }
  }
  const scheduler: OrbitPickScheduler = {
    frame: callback => enqueue(frames, callback),
    task: callback => enqueue(tasks, callback),
    now: () => 0,
  }
  const busy = vi.fn()
  const picked = vi.fn()
  const error = vi.fn()
  const picker = new OrbitPivotPicker(busy, picked, error, scheduler)
  const camera = new PerspectiveCamera(40, 1, 0.01, 100)
  camera.position.z = 5
  camera.updateProjectionMatrix()
  const group = new Group()
  const mesh: Mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
  group.add(mesh)
  function drain() {
    while (frames.length || tasks.length)
      (frames.shift() ?? tasks.shift())!()
  }
  return { picker, scheduler, frames, tasks, busy, picked, error, camera, group, mesh, drain }
}

describe('deferred orbit pivot picking', () => {
  // Report: user conversation, 2026-10-11 08:31:58 UTC.
  // ROOT CAUSE:
  // Pointer-up skinned every vertex synchronously before Vue could paint the loading state.
  // Captured geometry now advances after a paint opportunity, in cancellable bounded tasks.
  it('publishes busy before two paint frames and before expensive vertex work', () => {
    const state = setup()
    const vertices = vi.spyOn(Mesh.prototype, 'getVertexPosition')
    state.picker.pick(state.group, state.camera, center, rect)
    expect(state.busy).toHaveBeenLastCalledWith(true)
    expect(vertices).not.toHaveBeenCalled()
    state.frames.shift()!()
    expect(vertices).not.toHaveBeenCalled()
    expect(state.picked).not.toHaveBeenCalled()
    state.frames.shift()!()
    expect(state.picked.mock.calls[0][0].z).toBeCloseTo(0.5)
    expect(state.busy).toHaveBeenLastCalledWith(false)
    vertices.mockRestore()
  })

  it('matches exact picking through parent transforms and material groups', () => {
    const state = setup()
    state.mesh.material = [new MeshBasicMaterial(), new MeshBasicMaterial(), new MeshBasicMaterial(), new MeshBasicMaterial(), new MeshBasicMaterial(), new MeshBasicMaterial()]
    state.group.position.set(1, 0.4, -2)
    state.group.rotation.y = Math.PI / 4
    state.group.scale.setScalar(2)
    state.camera.position.set(1, 0.4, 5)
    state.camera.lookAt(1, 0.4, -2)
    const expected = pickModelOrbitPivot(state.group, state.camera, center, rect)!
    state.picker.pick(state.group, state.camera, center, rect)
    state.drain()
    expect(state.picked.mock.calls[0][0].distanceTo(expected)).toBeLessThan(0.000001)
  })

  it('retains the click-time camera, bone pose and morph weights during later animation', () => {
    const state = setup()
    state.group.remove(state.mesh)
    const geometry = new BoxGeometry()
    const count = geometry.attributes.position.count
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4))
    const weights = new Float32Array(count * 4)
    for (let index = 0; index < count; index++)
      weights[index * 4] = 1
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
    const morph = new Float32Array(count * 3)
    for (let index = 0; index < count; index++)
      morph[index * 3 + 2] = 1
    geometry.morphAttributes.position = [new Float32BufferAttribute(morph, 3)]
    geometry.morphTargetsRelative = true
    const bone = new Bone()
    const skin = new SkinnedMesh(geometry, new MeshBasicMaterial())
    skin.add(bone)
    skin.bind(new Skeleton([bone]))
    skin.morphTargetInfluences![0] = 0.25
    state.group.add(skin)
    state.picker.pick(state.group, state.camera, center, rect)
    bone.position.x = 10
    skin.morphTargetInfluences![0] = 1
    state.camera.position.x = 50
    state.group.updateMatrixWorld(true)
    state.drain()
    expect(state.picked.mock.calls[0][0].toArray()).toEqual([0, 0, 0.75])
  })

  it('refreshes attached bind inverses after moving the parent before capture', () => {
    const state = setup()
    state.group.remove(state.mesh)
    const geometry = new BoxGeometry()
    const count = geometry.attributes.position.count
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4))
    const weights = new Float32Array(count * 4)
    for (let index = 0; index < count; index++)
      weights[index * 4] = 1
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
    const bone = new Bone()
    const skin = new SkinnedMesh(geometry, new MeshBasicMaterial())
    skin.add(bone)
    skin.bind(new Skeleton([bone]))
    state.group.add(skin)
    state.group.updateMatrixWorld(true)
    state.group.position.x = 2
    state.camera.position.x = 2
    state.picker.pick(state.group, state.camera, center, rect)
    state.drain()
    expect(state.picked.mock.calls[0][0].toArray()).toEqual([2, 0, 0.5])
  })

  it('preserves per-instance transforms instead of choosing a false origin', () => {
    const state = setup()
    state.group.clear()
    const instances = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1)
    instances.setMatrixAt(0, new Matrix4().makeTranslation(2, 0, 0))
    state.group.add(instances)
    state.camera.position.x = 2
    state.picker.pick(state.group, state.camera, center, rect)
    instances.setMatrixAt(0, new Matrix4().makeTranslation(5, 0, 0))
    state.drain()
    expect(state.picked.mock.calls[0][0].toArray()).toEqual([2, 0, 0.5])
    expect(state.error).not.toHaveBeenCalled()
    expect(state.busy).toHaveBeenLastCalledWith(false)
  })

  it('captures distinct morph weights for each instance', () => {
    const state = setup()
    state.group.clear()
    const geometry = new BoxGeometry()
    const morph = new Float32Array(geometry.attributes.position.count * 3)
    for (let index = 0; index < geometry.attributes.position.count; index++)
      morph[index * 3 + 2] = 1
    geometry.morphAttributes.position = [new Float32BufferAttribute(morph, 3)]
    geometry.morphTargetsRelative = true
    const instances = new InstancedMesh(geometry, new MeshBasicMaterial(), 2)
    const weights = new Mesh(geometry)
    weights.morphTargetInfluences![0] = 0.25
    instances.setMorphAt(0, weights)
    weights.morphTargetInfluences![0] = 0.75
    instances.setMorphAt(1, weights)
    state.group.add(instances)
    state.picker.pick(state.group, state.camera, center, rect)
    weights.morphTargetInfluences![0] = 0
    instances.setMorphAt(1, weights)
    state.drain()
    expect(state.picked.mock.calls[0][0].toArray()).toEqual([0, 0, 1.25])
  })

  it('bounds each deformed-vertex task and permits cancellation during a large pick', () => {
    const state = setup()
    state.mesh.geometry = new BoxGeometry(1, 1, 1, 64, 64, 64)
    const vertices = vi.spyOn(Mesh.prototype, 'getVertexPosition')
    state.picker.pick(state.group, state.camera, center, rect)
    state.frames.shift()!()
    state.frames.shift()!()
    expect(vertices).toHaveBeenCalledTimes(4096)
    expect(state.tasks).toHaveLength(1)
    expect(state.busy).toHaveBeenLastCalledWith(true)
    state.picker.cancel()
    state.drain()
    expect(state.picked).not.toHaveBeenCalled()
    expect(state.busy).toHaveBeenLastCalledWith(false)
    expect(vertices).toHaveBeenCalledTimes(4096)
    vertices.mockRestore()
  })

  it.each(['geometry', 'position', 'hidden', 'material', 'side', 'opacity', 'draw-range', 'groups', 'morph-replacement', 'morph-count'] as const)('discards a partial pick after %s changes', (change) => {
    const state = setup()
    state.mesh.geometry = new BoxGeometry(1, 1, 1, 64, 64, 64)
    if (change === 'morph-replacement' || change === 'morph-count')
      state.mesh.geometry.morphAttributes.position = [state.mesh.geometry.getAttribute('position').clone()]
    state.picker.pick(state.group, state.camera, center, rect)
    state.frames.shift()!()
    state.frames.shift()!()
    if (change === 'geometry')
      state.mesh.geometry = new BoxGeometry()
    else if (change === 'position')
      state.mesh.geometry.attributes.position.needsUpdate = true
    else if (change === 'hidden')
      state.mesh.visible = false
    else if (change === 'material')
      state.mesh.material = new MeshBasicMaterial()
    else if (change === 'side')
      (state.mesh.material as MeshBasicMaterial).side = 1
    else if (change === 'opacity')
      (state.mesh.material as MeshBasicMaterial).opacity = 0
    else if (change === 'draw-range')
      state.mesh.geometry.setDrawRange(3, 3)
    else if (change === 'groups')
      state.mesh.geometry.clearGroups()
    else if (change === 'morph-replacement')
      state.mesh.geometry.morphAttributes.position![0] = state.mesh.geometry.getAttribute('position').clone()
    else
      state.mesh.geometry.morphAttributes.position!.push(state.mesh.geometry.getAttribute('position').clone())
    state.drain()
    expect(state.picked).not.toHaveBeenCalled()
    expect(state.error).not.toHaveBeenCalled()
    expect(state.busy).toHaveBeenLastCalledWith(false)
  })

  it('yields at the CPU deadline even before the vertex-count limit', () => {
    const state = setup()
    state.mesh.geometry = new BoxGeometry(1, 1, 1, 64, 64, 64)
    let now = 0
    state.scheduler.now = () => now++
    const vertices = vi.spyOn(Mesh.prototype, 'getVertexPosition')
    state.picker.pick(state.group, state.camera, center, rect)
    state.frames.shift()!()
    state.frames.shift()!()
    expect(vertices).toHaveBeenCalledTimes(32)
    expect(state.tasks).toHaveLength(1)
    state.picker.dispose()
    vertices.mockRestore()
  })

  it('new picks and repeated resets cannot publish an older result', () => {
    const state = setup()
    state.picker.pick(state.group, state.camera, center, rect)
    const staleFrame = state.frames[0]!
    state.picker.cancel()
    state.picker.cancel()
    staleFrame()
    expect(state.frames).toHaveLength(0)
    state.picker.pick(state.group, state.camera, { x: 0, y: 0 }, rect)
    state.picker.pick(state.group, state.camera, center, rect)
    state.drain()
    expect(state.picked).toHaveBeenCalledTimes(1)
    expect(state.busy).toHaveBeenLastCalledWith(false)
  })

  it('clears loading on an error and allows the next pick to succeed', () => {
    const state = setup()
    const vertices = vi.spyOn(Mesh.prototype, 'getVertexPosition').mockImplementationOnce(() => {
      throw new Error('test geometry failure')
    })
    state.picker.pick(state.group, state.camera, center, rect)
    state.drain()
    expect(state.error).toHaveBeenCalledTimes(1)
    expect(state.picked).not.toHaveBeenCalled()
    expect(state.busy).toHaveBeenLastCalledWith(false)
    state.picker.pick(state.group, state.camera, center, rect)
    state.drain()
    expect(state.picked).toHaveBeenCalledTimes(1)
    vertices.mockRestore()
  })

  it('clears loading for misses and ignores input after disposal', () => {
    const state = setup()
    state.picker.pick(state.group, state.camera, { x: 0, y: 0 }, rect)
    state.drain()
    expect(state.busy).toHaveBeenLastCalledWith(false)
    expect(state.picked).not.toHaveBeenCalled()
    state.picker.pick(state.group, state.camera, center, rect)
    const staleFrame = state.frames[0]!
    state.picker.dispose()
    staleFrame()
    state.picker.pick(state.group, state.camera, center, rect)
    state.drain()
    expect(state.picked).not.toHaveBeenCalled()
    expect(state.frames).toHaveLength(0)
    expect(state.busy).toHaveBeenLastCalledWith(false)
  })
})
