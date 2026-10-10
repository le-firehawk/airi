import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'satori-bot',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      LLM_API_KEY: 'satori-test-key',
      LLM_API_BASE_URL: 'http://localhost:11434/v1/',
      LLM_MODEL: 'satori-test-model',
    },
  },
})
