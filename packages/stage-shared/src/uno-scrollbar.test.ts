import { createGenerator } from 'unocss'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sharedUnoConfig } from '../../../uno.config'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shared scrollbar shortcuts', () => {
  // ROOT CAUSE:
  // Preset 4.0.0 includes compatibility-only constituents in its default shortcuts, but omits their rules.
  // Shared overrides retain the generated WebKit styles and remove only those unresolved constituents.
  it('resolves every constituent without changing native scrollbar styles', async () => {
    const warn = vi.spyOn(console, 'warn')
    const generator = await createGenerator(sharedUnoConfig())
    const tokens = [
      'scrollbar',
      'scrollbar-none',
      'scrollbar-thin',
      'scrollbar-rounded',
      'scrollbar-w-4px',
      'scrollbar-h-4px',
      'scrollbar-radius-2',
    ]
    const { css, matched } = await generator.generate(new Set(tokens))

    for (const token of tokens)
      expect(matched.has(token)).toBe(true)

    expect(css).toContain('.scrollbar{--scrollbar-track:#f5f5f5;--scrollbar-thumb:#ddd;--scrollbar-width:8px;--scrollbar-height:8px;--scrollbar-track-radius:4px;--scrollbar-thumb-radius:4px;overflow:auto;}')
    expect(css).toContain('.scrollbar::-webkit-scrollbar{width:var(--scrollbar-width);height:var(--scrollbar-height);}')
    expect(css).toContain('.scrollbar::-webkit-scrollbar-thumb{background-color:var(--scrollbar-thumb);}')
    expect(css).toContain('.scrollbar::-webkit-scrollbar-track{background-color:var(--scrollbar-track);}')
    expect(css).toContain('.scrollbar-none{scrollbar-width:none;}')
    expect(css).toContain('.scrollbar-none::-webkit-scrollbar{display:none;}')
    expect(css).toContain('.scrollbar-thin{--scrollbar-width:8px;--scrollbar-height:8px;}')
    expect(css).toContain('.scrollbar-rounded::-webkit-scrollbar-thumb{border-radius:var(--scrollbar-thumb-radius);}')
    expect(css).toContain('.scrollbar-rounded::-webkit-scrollbar-track{border-radius:var(--scrollbar-track-radius);}')
    expect(css).toContain('.scrollbar-w-4px{--scrollbar-width:4px;}')
    expect(css).toContain('.scrollbar-h-4px{--scrollbar-height:4px;}')
    expect(css).toContain('.scrollbar-radius-2{--scrollbar-track-radius:0.5rem;--scrollbar-thumb-radius:0.5rem;}')
    expect(warn).not.toHaveBeenCalled()
  })
})
