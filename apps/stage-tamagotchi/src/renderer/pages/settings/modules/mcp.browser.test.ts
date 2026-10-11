import type { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import type { ElectronMcpConfigText, ElectronMcpRuntimeStatus } from '../../../../shared/eventa'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { trackButtonPlugin } from '@proj-airi/stage-ui/directives/track-button'
import { createPinia, disposePinia } from 'pinia'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import McpSettings from './mcp.vue'

vi.mock('@proj-airi/stage-ui/composables', () => ({
  useAnalytics: () => ({
    trackMcpServerRemoved: vi.fn(),
    trackMcpConnectionTestRun: vi.fn(),
  }),
}))

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { electronMcpGetRuntimeStatus, electronMcpReadConfigText } = await import('../../../../shared/eventa')

  return {
    useElectronEventaInvoke: (event: Parameters<typeof useElectronEventaInvoke>[0]) => async () => {
      if (event === electronMcpGetRuntimeStatus)
        return { path: '/tmp/mcp.json', servers: [], updatedAt: 0 } satisfies ElectronMcpRuntimeStatus
      if (event === electronMcpReadConfigText) {
        return {
          path: '/tmp/mcp.json',
          text: JSON.stringify({
            mcpServers: {
              first: { command: 'first-server', args: [] },
              second: { command: 'second-server', args: [] },
            },
          }),
        } satisfies ElectronMcpConfigText
      }
      throw new Error(`Unexpected MCP invocation: ${event.sendEvent.id}`)
    },
  }
})

describe('saved MCP server details', () => {
  it('expands and collapses saved servers independently', async () => {
    const pinia = createPinia()
    onTestFinished(() => disposePinia(pinia))
    const screen = await render(McpSettings, {
      global: {
        plugins: [
          pinia,
          createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false }),
          autoAnimatePlugin,
          trackButtonPlugin,
        ],
      },
    })
    onTestFinished(() => screen.unmount())

    const expand = screen.getByRole('button', { name: 'settings.pages.modules.mcp-server.actions.expand' })
    const collapse = screen.getByRole('button', { name: 'settings.pages.modules.mcp-server.actions.collapse' })
    const commands = screen.getByPlaceholder('settings.pages.modules.mcp-server.fields.command.placeholder')
    await expect.element(expand.nth(1)).toBeVisible()
    expect(screen.getByRole('textbox').elements()).toHaveLength(0)

    await expand.nth(0).click()

    await expect.element(commands).toHaveValue('first-server')
    await expect.element(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(commands.elements()).toHaveLength(1)
    await expect.element(expand).toHaveAttribute('aria-expanded', 'false')

    await expand.click()

    await expect.element(commands.nth(1)).toHaveValue('second-server')
    await collapse.nth(0).click()

    await expect.poll(() => commands.elements().length).toBe(1)
    await expect.element(commands).toHaveValue('second-server')
    await collapse.click()

    await expect.poll(() => screen.getByRole('textbox').elements().length).toBe(0)
    await expect.element(expand.nth(1)).toHaveAttribute('aria-expanded', 'false')
  })
})
