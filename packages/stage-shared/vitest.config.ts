import type { TestProjectInlineConfiguration } from 'vitest/config'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export const stageSharedProjects: TestProjectInlineConfiguration[] = [
  {
    test: {
      name: 'stage-shared:node',
      include: ['src/**/*.test.ts'],
      exclude: ['src/**/*.browser.test.ts'],
    },
  },
  {
    test: {
      name: 'stage-shared:browser',
      include: ['src/**/*.browser.test.ts'],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
    },
  },
]

export default defineConfig({
  root: import.meta.dirname,
  test: {
    projects: stageSharedProjects,
  },
})
