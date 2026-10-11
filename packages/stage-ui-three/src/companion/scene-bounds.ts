import type { BufferAttribute, InterleavedBufferAttribute, Material, Object3D, PerspectiveCamera } from 'three'

import { Bone, Box3, InstancedMesh, Matrix4, Mesh, Skeleton, SkinnedMesh, Vector3 } from 'three'

import { transformMotionEnvelope } from './motion-framing'

/** Hard limits cover the entire sample, including meshes that appear late in the scene traversal. */
export interface SceneBoundsLimits {
  maxNodes: number
  maxMeshes: number
  maxVertexVisits: number
  maxVertexVisitsPerFrame: number
  maxInstances: number
}

interface AttributeVersion {
  attribute: BufferAttribute | InterleavedBufferAttribute
  version: number
}

interface MeshSample {
  source: Mesh
  snapshot: Mesh
  transform: Matrix4
  instances?: Matrix4[]
  attributes: AttributeVersion[]
  morphs: (BufferAttribute | InterleavedBufferAttribute)[] | undefined
  vertexCount: number
  vertexCost: number
  bounds: Box3
  relativeMorphs: boolean
}

function versionOf(attribute: BufferAttribute | InterleavedBufferAttribute) {
  return 'isInterleavedBufferAttribute' in attribute ? attribute.data.version : attribute.version
}

function visibleMaterial(material: Material) {
  return material.visible && (!material.transparent || material.opacity > 0)
}

function materialsVisible(mesh: Mesh) {
  return Array.isArray(mesh.material) ? mesh.material.some(visibleMaterial) : visibleMaterial(mesh.material)
}

function attributesFor(mesh: Mesh) {
  const geometry = mesh.geometry
  const attributes = [geometry.getAttribute('position'), ...(geometry.morphAttributes.position ?? [])]
  if (mesh instanceof SkinnedMesh)
    attributes.push(geometry.getAttribute('skinIndex'), geometry.getAttribute('skinWeight'))
  return attributes
}

/**
 * Captures one pose without copying vertex buffers. CPU skinning then advances in bounded batches on later frames.
 * Only complete bounds are published. Scene membership and geometry edits invalidate an unfinished sample.
 */
export class SceneBoundsSample {
  private readonly meshes: MeshSample[] = []
  private readonly members: { node: Object3D, parent: Object3D | null, visible: boolean, children: number, layers: number, materialVisible?: boolean }[] = []
  private readonly vertex = new Vector3()
  private readonly bounds = new Box3()
  private meshIndex = 0
  private vertexIndex = 0
  private instanceIndex = 0

  private constructor(private readonly root: Object3D, private readonly cameraLayers: number) {}

  /** Captures transforms, skinning matrices, and morph weights together. No vertex deformation runs during capture. */
  static capture(root: Object3D, camera: PerspectiveCamera, limits: SceneBoundsLimits, deadline: number): SceneBoundsSample | undefined {
    const sample = new SceneBoundsSample(root, camera.layers.mask)
    let ancestor = root.parent
    let ancestors = 0
    while (ancestor) {
      if (!ancestor.visible || ++ancestors > limits.maxNodes)
        return undefined
      ancestor = ancestor.parent
    }
    const pending = [{ node: root, visible: true }]
    const meshes: Mesh[] = []
    let work = 0
    let bones = 0
    while (pending.length > 0) {
      if (sample.members.length % 64 === 0 && performance.now() >= deadline)
        return undefined
      const { node, visible } = pending.pop()!
      if (sample.members.length >= limits.maxNodes || pending.length + node.children.length > limits.maxNodes - sample.members.length - 1)
        return undefined
      sample.members.push({ node, parent: node.parent, visible: node.visible, children: node.children.length, layers: node.layers.mask, materialVisible: node instanceof Mesh ? materialsVisible(node) : undefined })
      const rendered = visible && node.visible
      if (rendered && node instanceof Mesh && camera.layers.test(node.layers)) {
        const materialVisible = materialsVisible(node)
        if (materialVisible && !node.name.startsWith('vrm_interaction_') && !node.name.startsWith('VRMC_springBone_collider')) {
          const positions = node.geometry.getAttribute('position')
          if (positions && Number.isSafeInteger(positions.count) && positions.count > 0) {
            const morphs = node.geometry.morphAttributes.position?.length ?? 0
            if (1 + morphs > limits.maxVertexVisitsPerFrame)
              return undefined
            work += positions.count * (1 + morphs)
            if (node instanceof SkinnedMesh) {
              bones += node.skeleton.bones.length
              if (!node.geometry.getAttribute('skinIndex') || !node.geometry.getAttribute('skinWeight') || bones > limits.maxNodes)
                return undefined
            }
            if (node instanceof InstancedMesh) {
              if (node.count > limits.maxInstances || node.morphTexture)
                return undefined
              work += node.count * 8
            }
            meshes.push(node)
            if (work > limits.maxVertexVisits || meshes.length > limits.maxMeshes)
              return undefined
          }
        }
      }
      for (const child of node.children)
        pending.push({ node: child, visible: rendered })
    }
    if (meshes.length === 0)
      return undefined

    // Update bind inverses before capturing. Later animation must not alter the sampled pose.
    root.updateMatrixWorld(true)
    const rootInverse = root.matrixWorld.clone().invert()
    const skeletons = new Map<Skeleton, Skeleton>()
    for (const source of meshes) {
      if (performance.now() >= deadline)
        return undefined
      let snapshot: Mesh
      if (source instanceof SkinnedMesh) {
        const skin = new SkinnedMesh(source.geometry, source.material)
        let skeleton = skeletons.get(source.skeleton)
        if (!skeleton) {
          const capturedBones: Bone[] = []
          for (const bone of source.skeleton.bones) {
            if (capturedBones.length % 16 === 0 && performance.now() >= deadline)
              return undefined
            const copy = new Bone()
            copy.matrixWorld.copy(bone.matrixWorld)
            capturedBones.push(copy)
          }
          skeleton = new Skeleton(capturedBones, source.skeleton.boneInverses.map(inverse => inverse.clone()))
          skeletons.set(source.skeleton, skeleton)
        }
        skin.skeleton = skeleton
        skin.bindMatrix.copy(source.bindMatrix)
        skin.bindMatrixInverse.copy(source.bindMatrixInverse)
        snapshot = skin
      }
      else {
        snapshot = new Mesh(source.geometry, source.material)
      }
      snapshot.morphTargetInfluences = source.morphTargetInfluences?.slice()
      let instances: Matrix4[] | undefined
      if (source instanceof InstancedMesh) {
        instances = []
        for (let index = 0; index < source.count; index++) {
          const matrix = new Matrix4()
          source.getMatrixAt(index, matrix)
          instances.push(matrix)
        }
      }
      sample.meshes.push({
        source,
        snapshot,
        transform: rootInverse.clone().multiply(source.matrixWorld),
        instances,
        attributes: attributesFor(source).map(attribute => ({ attribute, version: versionOf(attribute) })),
        morphs: source.geometry.morphAttributes.position,
        vertexCount: source.geometry.getAttribute('position').count,
        vertexCost: 1 + (source.geometry.morphAttributes.position?.length ?? 0),
        bounds: new Box3(),
        relativeMorphs: source.geometry.morphTargetsRelative,
      })
    }
    return sample
  }

  /** A pending sample retains its captured pose, but never survives geometry or visibility changes. */
  valid(camera: PerspectiveCamera, deadline: number) {
    if (camera.layers.mask !== this.cameraLayers)
      return false
    for (let ancestor: Object3D | null = this.root; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible)
        return false
    }
    if (this.members.some(({ node, parent, visible, children, layers, materialVisible }, index) => (index % 64 === 0 && performance.now() >= deadline)
      || node.parent !== parent || node.visible !== visible
      || node.children.length !== children || node.layers.mask !== layers
      || (node instanceof Mesh && materialsVisible(node) !== materialVisible))) {
      return false
    }
    return this.meshes.every(({ source, snapshot, attributes, morphs, relativeMorphs }) => {
      if (performance.now() >= deadline)
        return false
      const current = attributesFor(source)
      const materialVisible = materialsVisible(source)
      return materialVisible && source.geometry.morphTargetsRelative === relativeMorphs && source.geometry === snapshot.geometry && source.geometry.morphAttributes.position === morphs
        && current.length === attributes.length
        && attributes.every(({ attribute, version }, index) => (index % 64 !== 0 || performance.now() < deadline)
          && current[index] === attribute && versionOf(attribute) === version)
    })
  }

  /** Returns undefined until all vertices finish. Invalid deformed geometry throws and must invalidate the whole sample. */
  advance(maxVertexVisits: number, deadline: number): Box3 | undefined {
    let visits = 0
    let vertices = 0
    while (this.meshIndex < this.meshes.length) {
      const mesh = this.meshes[this.meshIndex]!
      while (this.vertexIndex < mesh.vertexCount) {
        if (visits + mesh.vertexCost > maxVertexVisits || (vertices % 64 === 0 && performance.now() >= deadline))
          return undefined
        mesh.snapshot.getVertexPosition(this.vertexIndex++, this.vertex)
        if (![this.vertex.x, this.vertex.y, this.vertex.z].every(Number.isFinite))
          throw new Error('Invalid deformed vertex')
        mesh.bounds.expandByPoint(this.vertex)
        visits += mesh.vertexCost
        vertices++
      }
      if (mesh.instances) {
        while (this.instanceIndex < mesh.instances.length) {
          if (visits + 8 > maxVertexVisits || performance.now() >= deadline)
            return undefined
          const matrix = mesh.instances[this.instanceIndex++]!
          visits += 8
          const transformed = transformMotionEnvelope(mesh.bounds, mesh.transform.clone().multiply(matrix))
          if (!transformed)
            throw new Error('Invalid instance bounds')
          this.bounds.union(transformed)
        }
      }
      else {
        const transformed = transformMotionEnvelope(mesh.bounds, mesh.transform)
        if (!transformed)
          throw new Error('Invalid mesh bounds')
        this.bounds.union(transformed)
      }
      this.meshIndex++
      this.vertexIndex = 0
      this.instanceIndex = 0
    }
    return this.bounds.isEmpty() ? undefined : this.bounds
  }
}
