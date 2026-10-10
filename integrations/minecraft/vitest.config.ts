import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'minecraft-bot',
    include: ['src/**/*.test.ts'],
    exclude: ['src/agents/action/*.test.ts'],
  },
})
