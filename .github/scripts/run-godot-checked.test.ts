import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./run-godot-checked.sh', import.meta.url))

function run(command: string) {
  const directory = mkdtempSync(join(tmpdir(), 'airi-godot-gate-'))
  const log = join(directory, 'godot.log')
  try {
    const result = spawnSync('bash', [script, log, 'bash', '-c', command], { encoding: 'utf8' })
    return { ...result, log: readFileSync(log, 'utf8') }
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('godot diagnostic gate', () => {
  it('accepts a successful command and preserves stdout and stderr', () => {
    const result = run('echo Exported; echo Diagnostic >&2')
    expect(result.status).toBe(0)
    expect(result.log).toContain('Exported\nDiagnostic\n')
  })

  it.each(['SCRIPT ERROR', 'ERROR', 'FATAL'])('rejects %s even when the engine exits successfully', (kind) => {
    const result = run(`printf '\\033[31m${kind}: broken script\\033[0m\\n' >&2`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Godot reported an engine or script error')
  })

  it('preserves a failing command exit status', () => {
    expect(run('echo Failed; exit 23').status).toBe(23)
  })

  it('retains ordinary warning feedback without misclassifying prose as an error', () => {
    const result = run('echo "WARNING: investigate this"; echo "Expected ERROR: in fixture"')
    expect(result.status).toBe(0)
    expect(result.log).toContain('WARNING: investigate this')
  })
})
