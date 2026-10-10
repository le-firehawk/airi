import { basename, resolve } from 'node:path'

import { build, createLogger } from 'vite'
import { expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

async function buildBrowserEntry(packageDirectory: string, source: string) {
  const root = resolve(repositoryRoot, packageDirectory)
  const entry = resolve(root, 'browser-runtime-regression.ts')
  const warnings: string[] = []
  const logger = createLogger('silent')
  logger.warn = warning => warnings.push(warning)
  logger.warnOnce = warning => warnings.push(warning)

  const result = await build({
    root,
    configFile: false,
    customLogger: logger,
    base: './',
    plugins: [{
      name: 'browser-runtime-regression',
      resolveId(id) {
        if (id === entry)
          return entry
      },
      load(id) {
        if (id === entry)
          return source
      },
    }],
    worker: { format: 'es' },
    build: {
      write: false,
      reportCompressedSize: false,
      rolldownOptions: { input: entry, preserveEntrySignatures: 'strict' },
    },
  })

  const results = Array.isArray(result) ? result : [result]
  const output = results.flatMap(result => 'output' in result ? result.output : [])
  const scripts = output.flatMap((file) => {
    if (file.type === 'chunk')
      return [file.code]
    if (file.fileName.endsWith('.js'))
      return [typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source)]
    return []
  })

  expect(output.length).toBeGreaterThan(0)
  expect(scripts.some(script => script.includes('__vite-browser-external'))).toBe(false)
  expect(scripts.some(script => /(?:from\s*|import\s*\()["'](?:node:|module["'])/.test(script))).toBe(false)

  expect(warnings).toEqual([])
  return { output, scripts }
}

// https://github.com/le-firehawk/airi/actions/runs/38017667646/job/114111461965
// ROOT CAUSE:
// DuckDB 0.6.0 selected Node imports before runtime environment detection.
// Its conditional runtime import keeps Node worker code outside browser builds.
it('bundles DuckDB browser workers without Node-only imports', async () => {
  const { output, scripts } = await buildBrowserEntry('packages/stage-ui', `
    export { drizzle } from '@proj-airi/drizzle-duckdb-wasm'
    export { getImportUrlBundles } from '@proj-airi/drizzle-duckdb-wasm/bundles/import-url-browser'
  `)

  expect(output.filter(file => file.fileName.endsWith('.wasm'))).toHaveLength(3)
  expect(output.filter(file => /duckdb-browser-.*worker.*\.js$/.test(file.fileName))).toHaveLength(4)
  expect(output.some(file => file.fileName.includes('duckdb-node-'))).toBe(false)
  expect(scripts.some(script => script.includes('default-node'))).toBe(false)
}, 30_000)

// https://github.com/le-firehawk/airi/actions/runs/38017667646/job/114111461965
// ROOT CAUSE:
// The Sherpaw 0.2.1 loader used an absent WASM path and imported Node's module API.
// Its conditional environment import and prebuilt asset path keep renderer and worker builds valid.
it('emits Sherpaw WASM for both the renderer and transcription worker', async () => {
  const { output, scripts } = await buildBrowserEntry('packages/provider-inference', `
    export { initASRModule } from '@sherpaw/asr'
    export { default as wasmURL } from '@sherpaw/asr/module.wasm?url&no-inline'
    export { default as workerURL } from '@sherpaw/xsai-transcription/worker?worker&url'
  `)

  const wasm = output.filter(file => file.fileName.endsWith('.wasm'))
  expect(wasm).toHaveLength(1)
  expect(scripts.some(script => script.includes(basename(wasm[0].fileName)))).toBe(true)
  expect(output.some(file => file.type === 'asset' && /index-.*\.js$/.test(file.fileName))).toBe(true)
}, 30_000)
