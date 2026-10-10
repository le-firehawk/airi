import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'discord-bot',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
