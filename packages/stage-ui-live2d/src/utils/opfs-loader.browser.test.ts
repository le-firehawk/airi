import JSZip from 'jszip'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OPFSCache } from './opfs-loader'

function blobFromBytes(data: Uint8Array): Blob {
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return new Blob([buffer])
}

async function createZip(entries: Record<string, Blob | string | Uint8Array>): Promise<Blob> {
  const zip = new JSZip()

  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content)
  }

  const data = await zip.generateAsync({ type: 'uint8array' })
  return new Blob([await blobFromBytes(data).arrayBuffer()], { type: 'application/zip' })
}

async function writeLegacyCache(root: FileSystemDirectoryHandle, key: string): Promise<void> {
  const dir = await root.getDirectoryHandle(key, { create: true })
  await OPFSCache.writeFile(
    dir,
    'model.model3.json',
    JSON.stringify({ Version: 3 }),
  )
}

function filePaths(files: File[]): string[] {
  return files.map(file => file.webkitRelativePath).sort()
}

describe('opfs cache full directory persistence', () => {
  let root: FileSystemDirectoryHandle

  beforeEach(async () => {
    root = await navigator.storage.getDirectory()
    await OPFSCache.clearAll()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await OPFSCache.clearAll()
  })

  it('saves every zip entry and restores webkitRelativePath from the physical OPFS directory', async () => {
    const zipBlob = await createZip({
      '__MACOSX/._model.model3.json': new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0]),
      '._model.moc3': new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0]),
      'model.model3.json': JSON.stringify({
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['textures/texture_00.png'] },
      }),
      'model.moc3': new Uint8Array([77, 79, 67, 51]),
      'textures/texture_00.png': new Uint8Array([1, 2, 3]),
      'extra/readme.txt': 'kept from original archive',
    })

    await OPFSCache.save('live2d-model', zipBlob, 'blob:first')

    const files = await OPFSCache.get('live2d-model', 'blob:second')

    expect(files).not.toBeNull()
    expect(filePaths(files ?? [])).toEqual([
      'extra/readme.txt',
      'model.moc3',
      'model.model3.json',
      'textures/texture_00.png',
    ])
  })

  it('does not restore ignored archive metadata that already exists in OPFS', async () => {
    const dir = await root.getDirectoryHandle('metadata-model', { create: true })
    await OPFSCache.writeFile(
      dir,
      '__MACOSX/._model.model3.json',
      new Blob([new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0])]),
    )
    await OPFSCache.writeFile(
      dir,
      'model.model3.json',
      JSON.stringify({
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      }),
    )
    await OPFSCache.writeFile(
      dir,
      '__meta.json',
      JSON.stringify({ sourceUrl: 'blob:first', version: 3 }),
    )

    const files = await OPFSCache.get('metadata-model', 'blob:second')

    expect(files).not.toBeNull()
    expect(filePaths(files ?? [])).toEqual(['model.model3.json'])
  })

  it('keeps the original model3.json text without reconstructing or double-encoding paths', async () => {
    const encodedMoc = encodeURI('八千代辉夜姬.moc3')
    const settingsText = JSON.stringify({
      Version: 3,
      FileReferences: {
        Moc: encodedMoc,
        Textures: ['textures/texture_00.png'],
      },
    })
    const zipBlob = await createZip({
      'model.model3.json': settingsText,
      [encodedMoc]: new Uint8Array([77, 79, 67, 51]),
      'textures/texture_00.png': new Uint8Array([1, 2, 3]),
    })

    await OPFSCache.save('encoded-model', zipBlob, 'blob:first')
    const files = await OPFSCache.get('encoded-model', 'blob:second')
    const settingsFile = files?.find(file => file.webkitRelativePath === 'model.model3.json')

    expect(settingsFile).toBeDefined()
    expect(await settingsFile?.text()).toBe(settingsText)
    expect(await settingsFile?.text()).not.toContain('%25E5')
  })

  it('invalidates caches that were written before the full-directory schema version', async () => {
    await writeLegacyCache(root, 'legacy-model')

    const files = await OPFSCache.get('legacy-model', 'blob:current')

    expect(files).toBeNull()
    await expect(root.getDirectoryHandle('legacy-model', { create: false })).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('invalidates non-blob URL cache entries when the source URL changes', async () => {
    const zipBlob = await createZip({
      '__MACOSX/._model.model3.json': new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0]),
      'model.model3.json': JSON.stringify({
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      }),
      'model.moc3': new Uint8Array([77, 79, 67, 51]),
      'texture.png': new Uint8Array([1, 2, 3]),
    })

    await OPFSCache.save('remote-model', zipBlob, 'https://example.test/a.zip')
    const files = await OPFSCache.get('remote-model', 'https://example.test/b.zip')

    expect(files).toBeNull()
    await expect(root.getDirectoryHandle('remote-model', { create: false })).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('does not invalidate blob URL cache entries when the stable model key matches', async () => {
    const zipBlob = await createZip({
      'model.model3.json': JSON.stringify({
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      }),
      'model.moc3': new Uint8Array([77, 79, 67, 51]),
      'texture.png': new Uint8Array([1, 2, 3]),
    })

    await OPFSCache.save('blob-model', zipBlob, 'blob:first')
    const files = await OPFSCache.get('blob-model', 'blob:second')

    expect(files).not.toBeNull()
    expect(filePaths(files ?? [])).toEqual([
      'model.moc3',
      'model.model3.json',
      'texture.png',
    ])
  })

  it('reads an asar file response through arrayBuffer when Response.blob fails', async () => {
    const zipBlob = await createZip({
      'model.model3.json': JSON.stringify({
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      }),
      'model.moc3': new Uint8Array([77, 79, 67, 51]),
      'texture.png': new Uint8Array([1, 2, 3]),
      'not-defined-by-settings.txt': 'still cached',
    })
    const responseBlob = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const responseArrayBuffer = vi.fn(async () => zipBlob.arrayBuffer())
    vi.stubGlobal('fetch', vi.fn(async () => ({
      arrayBuffer: responseArrayBuffer,
      blob: responseBlob,
      headers: new Headers({ 'content-type': 'application/zip' }),
    })))
    const context = {
      source: {
        id: 'middleware-model',
        url: 'file:///C:/AIRI/resources/app.asar/out/renderer/assets/model.zip',
      },
    } as Parameters<typeof OPFSCache.checkMiddleware>[0]
    const checkNext = vi.fn(async () => {})

    await OPFSCache.checkMiddleware(context, checkNext)
    context.source = []
    await OPFSCache.saveMiddleware(context, vi.fn(async () => {}))

    const files = await OPFSCache.get('middleware-model', 'blob:next')

    expect(checkNext).toHaveBeenCalledTimes(1)
    expect(responseArrayBuffer).toHaveBeenCalledTimes(1)
    expect(responseBlob).not.toHaveBeenCalled()
    expect(context.opfsZipBlob?.type).toBe('application/zip')
    expect(files).not.toBeNull()
    expect(filePaths(files ?? [])).toEqual([
      'model.moc3',
      'model.model3.json',
      'not-defined-by-settings.txt',
      'texture.png',
    ])
  })

  it('preserves bytes and content type for ordinary blob URLs', async () => {
    const sourceBlob = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: 'application/zip',
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sourceBlob)))
    const context = {
      source: { id: 'blob-model', url: 'blob:source' },
    } as Parameters<typeof OPFSCache.checkMiddleware>[0]

    await OPFSCache.checkMiddleware(context, vi.fn(async () => {}))

    expect(context.opfsZipBlob?.type).toBe('application/zip')
    expect(new Uint8Array(await context.opfsZipBlob!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
  })
})
