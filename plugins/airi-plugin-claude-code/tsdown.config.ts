import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['./src/run.ts'],
    deps: {
      onlyBundle: [],
    },
    platform: 'node',
    dts: true,
    unused: true,
    publint: true,
  },
])
