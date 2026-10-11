import type { BufferAttribute as Attribute, Camera, InterleavedBufferAttribute, Material, Object3D } from 'three'

import { Bone, Box3, BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, Mesh, Raycaster, Skeleton, SkinnedMesh, Sphere, Vector2, Vector3 } from 'three'

interface PickMesh {
  owner: Mesh
  materials: { material: Material, visible: boolean, opacity: number, side: Material['side'] }[]
  transforms: Matrix4[]
  instance: number
  instanceMorphs?: number[][]
  relativeMorphs: boolean
  drawStart: number
  drawCount: number
  parent: Object3D | null
  attributes: { name: string, attribute: Attribute | InterleavedBufferAttribute, version: number }[]
  index: BufferGeometry['index']
  indexVersion: number | undefined
  morphs: BufferGeometry['morphAttributes']['position']
  morphAttributes: { attribute: Attribute | InterleavedBufferAttribute, version: number }[]
  source: Mesh
  surface: Mesh
  positions: Float32Array
  bounds: Box3
  vertex: number
  triangle: number
  drawEnd: number
}

/** Scheduling stays outside Vue so cancellation also owns queued browser callbacks. */
export interface OrbitPickScheduler {
  frame: (callback: () => void) => () => void
  task: (callback: () => void) => () => void
  now: () => number
}

function attributeVersion(attribute: Attribute | InterleavedBufferAttribute) {
  return 'isInterleavedBufferAttribute' in attribute ? attribute.data.version : attribute.version
}

const browserScheduler: OrbitPickScheduler = {
  frame(callback) {
    const handle = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(handle)
  },
  task(callback) {
    const handle = setTimeout(callback, 0)
    return () => clearTimeout(handle)
  },
  now: () => performance.now(),
}

/**
 * Owns one click-time pose and ray until completion or cancellation. A newer click replaces the pending pick.
 * Two animation frames let the loading state paint before vertex work. Each later task has a bounded CPU budget.
 */
export class OrbitPivotPicker {
  private revision = 0
  private disposed = false
  private cancelScheduled: (() => void) | undefined
  private meshes: PickMesh[] = []
  private meshIndex = 0
  private raycaster = new Raycaster()
  private nearest: Vector3 | undefined
  private nearestDistance = Infinity
  private readonly vertex = new Vector3()

  constructor(
    private readonly onBusy: (busy: boolean) => void,
    private readonly onPick: (point: Vector3) => void,
    private readonly onError: (error: unknown) => void,
    private readonly scheduler: OrbitPickScheduler = browserScheduler,
  ) {}

  /** No deformed vertices are visited until the busy state has had a paint opportunity. */
  pick(model: Object3D, camera: Camera, point: { x: number, y: number }, rect: { left: number, top: number, width: number, height: number }) {
    this.cancel()
    if (this.disposed || rect.width <= 0 || rect.height <= 0)
      return
    const x = (point.x - rect.left) / rect.width
    const y = (point.y - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1)
      return
    const revision = this.revision
    this.onBusy(true)
    try {
      model.updateWorldMatrix(true, false)
      model.updateMatrixWorld(true)
      camera.updateWorldMatrix(true, false)
      this.raycaster = new Raycaster()
      this.raycaster.layers.mask = camera.layers.mask
      this.raycaster.setFromCamera(new Vector2(x * 2 - 1, 1 - y * 2), camera)
      const skeletons = new Map<Skeleton, Skeleton>()
      model.traverseVisible((object) => {
        if (!(object instanceof Mesh) || !camera.layers.test(object.layers))
          return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        if (!materials.some(material => material.visible && material.opacity > 0))
          return
        const attribute = object.geometry.getAttribute('position')
        if (!attribute)
          return
        let source: Mesh
        if (object instanceof SkinnedMesh) {
          const skin = new SkinnedMesh(object.geometry, object.material)
          let skeleton = skeletons.get(object.skeleton)
          if (!skeleton) {
            const bones = object.skeleton.bones.map((bone) => {
              const copy = new Bone()
              copy.matrixWorld.copy(bone.matrixWorld)
              return copy
            })
            skeleton = new Skeleton(bones, object.skeleton.boneInverses.map(matrix => matrix.clone()))
            skeletons.set(object.skeleton, skeleton)
          }
          skin.skeleton = skeleton
          skin.bindMatrix.copy(object.bindMatrix)
          skin.bindMatrixInverse.copy(object.bindMatrixInverse)
          source = skin
        }
        else {
          source = new Mesh(object.geometry, object.material)
        }
        source.morphTargetInfluences = object.morphTargetInfluences?.slice()
        const positions = new Float32Array(attribute.count * 3)
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(positions, 3))
        geometry.setIndex(object.geometry.index)
        geometry.groups = (object.geometry as BufferGeometry).groups.map(group => ({ ...group }))
        const surface = new Mesh(geometry, object.material)
        const transforms: Matrix4[] = []
        let instanceMorphs: number[][] | undefined
        if (object instanceof InstancedMesh) {
          if (object.morphTexture) {
            instanceMorphs = []
            source.morphTargetInfluences = Array.from<number>({ length: object.geometry.morphAttributes.position?.length ?? 0 }).fill(0)
          }
          for (let index = 0; index < object.count; index++) {
            const transform = new Matrix4()
            object.getMatrixAt(index, transform)
            transforms.push(transform.premultiply(object.matrixWorld))
            if (instanceMorphs) {
              object.getMorphAt(index, source)
              instanceMorphs.push(source.morphTargetInfluences!.slice())
            }
          }
          if (instanceMorphs)
            source.morphTargetInfluences = instanceMorphs[0]
        }
        else {
          transforms.push(object.matrixWorld.clone())
        }
        if (transforms.length === 0)
          return
        surface.matrixWorld.copy(transforms[0]!)
        surface.layers.mask = object.layers.mask
        const drawStart = object.geometry.drawRange.start
        const drawEnd = Math.min(drawStart + object.geometry.drawRange.count, object.geometry.index?.count ?? attribute.count)
        const originalGeometry = object.geometry as BufferGeometry
        this.meshes.push({
          owner: object,
          materials: materials.map(material => ({ material, visible: material.visible, opacity: material.opacity, side: material.side })),
          transforms,
          instance: 0,
          instanceMorphs,
          relativeMorphs: originalGeometry.morphTargetsRelative,
          drawStart,
          drawCount: originalGeometry.drawRange.count,
          parent: object.parent,
          attributes: Object.entries(originalGeometry.attributes).map(([name, attribute]) => ({ name, attribute, version: attributeVersion(attribute) })),
          index: originalGeometry.index,
          indexVersion: originalGeometry.index?.version,
          morphs: originalGeometry.morphAttributes.position,
          morphAttributes: originalGeometry.morphAttributes.position?.map(attribute => ({ attribute, version: attributeVersion(attribute) })) ?? [],
          source,
          surface,
          positions,
          bounds: new Box3(),
          vertex: 0,
          triangle: drawStart,
          drawEnd,
        })
      })
      this.cancelScheduled = this.scheduler.frame(() => {
        if (revision !== this.revision)
          return
        this.cancelScheduled = this.scheduler.frame(() => this.advance(revision))
      })
    }
    catch (error) {
      this.fail(revision, error)
    }
  }

  /** Reset, model replacement, and new camera input discard the captured pose and pending result. */
  cancel() {
    this.revision++
    this.cancelScheduled?.()
    this.cancelScheduled = undefined
    for (const mesh of this.meshes)
      mesh.surface.geometry.dispose()
    this.meshes = []
    this.meshIndex = 0
    this.nearest = undefined
    this.nearestDistance = Infinity
    this.onBusy(false)
  }

  dispose() {
    this.disposed = true
    this.cancel()
  }

  private fail(revision: number, error: unknown) {
    if (revision !== this.revision)
      return
    this.cancel()
    this.onError(error)
  }

  private advance(revision: number) {
    if (this.disposed || revision !== this.revision)
      return
    this.cancelScheduled = undefined
    const deadline = this.scheduler.now() + 2
    let visits = 0
    try {
      if (this.meshes.some(mesh => !this.isCurrent(mesh))) {
        this.cancel()
        return
      }
      while (this.meshIndex < this.meshes.length) {
        const mesh = this.meshes[this.meshIndex]!
        const count = mesh.positions.length / 3
        while (mesh.vertex < count) {
          if (visits >= 4096 || (visits % 32 === 0 && this.scheduler.now() >= deadline)) {
            this.schedule(revision)
            return
          }
          mesh.source.getVertexPosition(mesh.vertex, this.vertex)
          if (![this.vertex.x, this.vertex.y, this.vertex.z].every(Number.isFinite))
            throw new Error('Invalid orbit pick vertex')
          this.vertex.toArray(mesh.positions, mesh.vertex * 3)
          mesh.bounds.expandByPoint(this.vertex)
          mesh.vertex++
          visits++
        }
        const geometry = mesh.surface.geometry
        if (!geometry.boundingBox) {
          geometry.boundingBox = mesh.bounds
          geometry.boundingSphere = mesh.bounds.getBoundingSphere(new Sphere())
        }
        while (mesh.triangle < mesh.drawEnd) {
          if (visits + 3 > 4096 || this.scheduler.now() >= deadline) {
            this.schedule(revision)
            return
          }
          const batch = Math.min(768, Math.floor((4096 - visits) / 3) * 3)
          const end = Math.min(mesh.drawEnd, mesh.triangle + batch)
          geometry.setDrawRange(mesh.triangle, end - mesh.triangle)
          const hit = this.raycaster.intersectObject(mesh.surface, false)[0]
          if (hit && hit.distance < this.nearestDistance) {
            this.nearestDistance = hit.distance
            this.nearest = hit.point.clone()
          }
          visits += end - mesh.triangle
          mesh.triangle = end
        }
        mesh.instance++
        if (mesh.instance < mesh.transforms.length) {
          mesh.surface.matrixWorld.copy(mesh.transforms[mesh.instance]!)
          mesh.triangle = mesh.drawStart
          if (mesh.instanceMorphs) {
            mesh.source.morphTargetInfluences = mesh.instanceMorphs[mesh.instance]
            mesh.vertex = 0
            mesh.bounds.makeEmpty()
            geometry.boundingBox = null
            geometry.boundingSphere = null
          }
        }
        else {
          this.meshIndex++
        }
      }
      const result = this.nearest
      this.cancel()
      if (result)
        this.onPick(result)
    }
    catch (error) {
      this.fail(revision, error)
    }
  }

  private isCurrent(mesh: PickMesh) {
    if (mesh.owner.parent !== mesh.parent || mesh.owner.geometry !== mesh.source.geometry)
      return false
    for (let node: Object3D | null = mesh.owner; node; node = node.parent) {
      if (!node.visible)
        return false
    }
    const geometry = mesh.owner.geometry as BufferGeometry
    const materials = Array.isArray(mesh.owner.material) ? mesh.owner.material : [mesh.owner.material]
    if (materials.length !== mesh.materials.length
      || mesh.materials.some((entry, index) => materials[index] !== entry.material
        || entry.material.visible !== entry.visible || entry.material.opacity !== entry.opacity || entry.material.side !== entry.side)) {
      return false
    }
    if (mesh.owner instanceof InstancedMesh && mesh.owner.count !== mesh.transforms.length)
      return false
    return geometry.drawRange.start === mesh.drawStart && geometry.drawRange.count === mesh.drawCount
      && geometry.groups.length === mesh.surface.geometry.groups.length
      && geometry.groups.every((group, index) => {
        const original = mesh.surface.geometry.groups[index]!
        return group.start === original.start && group.count === original.count && group.materialIndex === original.materialIndex
      })
      && geometry.morphTargetsRelative === mesh.relativeMorphs
      && geometry.index === mesh.index && geometry.index?.version === mesh.indexVersion
      && mesh.attributes.every(({ name, attribute, version }) => geometry.getAttribute(name) === attribute && attributeVersion(attribute) === version)
      && geometry.morphAttributes.position === mesh.morphs
      && (geometry.morphAttributes.position?.length ?? 0) === mesh.morphAttributes.length
      && mesh.morphAttributes.every(({ attribute, version }, index) => geometry.morphAttributes.position?.[index] === attribute && attributeVersion(attribute) === version)
  }

  private schedule(revision: number) {
    this.cancelScheduled = this.scheduler.task(() => this.advance(revision))
  }
}
