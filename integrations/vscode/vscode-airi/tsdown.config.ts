import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['./src/extension.ts'],
    format: 'cjs',
    platform: 'node',
    deps: {
      neverBundle: ['vscode'],
      onlyBundle: false,
    },
    sourcemap: true,
    clean: true,
    dts: false,
  },
])
