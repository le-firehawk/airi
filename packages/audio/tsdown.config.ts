import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'browser/index': 'src/browser/index.ts',
    'browser/capture.worklet': 'src/browser/capture.worklet.ts',
    'encoding/index': 'src/encoding/index.ts',
  },
  unbundle: true,
  deps: {
    neverBundle: [
      './capture.worklet?worker&url',
    ],
  },
})
