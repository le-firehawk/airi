import { cwd } from 'node:process'

import vue from '@vitejs/plugin-vue'
import UnoCss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import VueRouter from 'vue-router/vite'

import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk'
import { playwright } from '@vitest/browser-playwright'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

import unoConfig from './uno.config'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    Info(),
    // Use the app's route-block transform when browser tests mount settings pages.
    VueRouter({ routesFolder: [], dts: false }),
    vue(),
    UnoCss({
      ...unoConfig,
      // NOTICE:
      // Config discovery shallow-merges over inline content and loses the initial stylesheet scan.
      // Source: loadConfig in node_modules/@unocss/config/dist/index.mjs.
      // Remove configFile: false and explicit unoConfig imports when discovery preserves
      // content.filesystem, then verify the shuffled browser suite.
      configFile: false,
      // Generate the initial stylesheet before parallel browser files mount.
      // Late utility extraction can resize controls during layout assertions.
      content: {
        ...unoConfig.content,
        filesystem: [
          `${import.meta.dirname}/src/**/*.vue`,
          `${import.meta.dirname}/../../packages/stage-layouts/src/**/*.vue`,
          `${import.meta.dirname}/../../packages/stage-ui/src/**/*.vue`,
          `${import.meta.dirname}/../../packages/ui/src/**/*.vue`,
        ],
      },
    }),
  ],
  test: {
    env: loadEnv('test', cwd(), ''),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts', '**/node_modules/**', '**/.git/**'],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        plugins: [DownloadLive2DSDK()],
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          exclude: ['**/node_modules/**', '**/.git/**'],
          setupFiles: ['./src/test/setup-live2d.browser.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              { browser: 'chromium' },
            ],
          },
        },
      },
    ],
  },
})
