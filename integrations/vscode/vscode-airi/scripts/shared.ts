// https://github.com/unocss/unocss/blob/dba521e377887ed2b3b38dc86f36d4f292230ac8/packages-integrations/vscode/scripts/dev.ts

import { readFile, writeFile } from 'node:fs/promises'

export async function packageJSONForVSCode(name: string) {
  const json = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
  const originalName = json.name
  const originalVersion = json.version

  if (json.name !== name) {
    json.name = name

    await writeFile(new URL('../package.json', import.meta.url), `${JSON.stringify(json, null, 2)}\n`, 'utf-8')
  }

  const numericVersion = encodeNumericVersion(originalVersion)
  if (json.version !== numericVersion.version) {
    json.version = numericVersion.version

    await writeFile(new URL('../package.json', import.meta.url), `${JSON.stringify(json, null, 2)}\n`, 'utf-8')
  }

  return {
    json,
    originalName,
    originalVersion,
    name,
    version: numericVersion.version,
    isPreview: numericVersion.preview,
    restore: async () => {
      json.name = originalName
      json.version = originalVersion

      await writeFile(new URL('../package.json', import.meta.url), `${JSON.stringify(json, null, 2)}\n`, 'utf-8')
    },
  }
}

// VSCE rejects prerelease identifiers. Encode patch*10000 + stageBucket + sequence, with buckets alpha=1000, beta=2000, rc=3000, stable=9000. Unknown stages use alpha. For example, 0.8.0-alpha.6 becomes 0.8.1006.
export function encodeNumericVersion(version: string) {
  const match = version.match(/^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(-(?<pre>[0-9A-Z.-]+))?$/i)
  if (!match || !match.groups)
    throw new Error(`Invalid semver: ${version}`)

  const major = Number.parseInt(match.groups.major, 10)
  const minor = Number.parseInt(match.groups.minor, 10)
  const patch = Number.parseInt(match.groups.patch, 10)
  const prerelease = match.groups.pre

  const multiplier = 10_000
  const stageBuckets = {
    alpha: 1_000,
    beta: 2_000,
    rc: 3_000,
    stable: 9_000,
  } as const

  const { stage, sequence } = parsePrerelease(prerelease)
  const maxSequence = (multiplier - 1) - stageBuckets[stage]
  if (sequence > maxSequence) {
    throw new Error(`Prerelease sequence overflow for ${stage}: ${sequence} exceeds limit ${maxSequence}`)
  }
  if (sequence < 0) {
    throw new Error(`Prerelease sequence must be non-negative: ${sequence}`)
  }

  const encodedPatch = (patch * multiplier) + (stageBuckets[stage] ?? stageBuckets.alpha) + sequence
  const encoded = `${major}.${minor}.${encodedPatch}`

  return {
    version: encoded,
    preview: stage !== 'stable',
  }
}

function parsePrerelease(prerelease?: string) {
  if (!prerelease) {
    return { stage: 'stable' as const, sequence: 0 }
  }

  const [stageRaw, sequenceRaw] = prerelease.split('.')
  const stage = stageRaw === 'beta' || stageRaw === 'rc' || stageRaw === 'alpha' ? stageRaw : 'alpha'
  const sequenceParsed = Number.parseInt(sequenceRaw ?? '', 10)
  const sequence = Number.isFinite(sequenceParsed) ? sequenceParsed : 0

  return { stage, sequence }
}
