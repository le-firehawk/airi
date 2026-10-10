import type { WebSocketEvents } from '@proj-airi/server-sdk'

import { Client } from '@proj-airi/server-sdk'
import { describe, expect, it, vi } from 'vitest'

import { AiriBridge } from './airi-bridge'

function createBridgeHarness(options: { commandAvailable?: boolean } = {}) {
  const client = new Client({ name: 'bridge-test', autoConnect: false, heartbeat: false })
  vi.spyOn(client, 'send').mockReturnValue(true)
  const subscriptions = vi.spyOn(client, 'onEvent')
  const handlers = {
    get(type: string) {
      const subscription = subscriptions.mock.calls.find(([event]) => event === type)
      if (!subscription)
        return undefined
      return (event: { data: WebSocketEvents['spark:command'] }) => subscription[1]({
        type: 'spark:command',
        data: event.data,
        metadata: { source: { id: 'bridge-test' }, event: { id: event.data.commandId } },
      })
    },
  }
  const eventBus = {
    emit: vi.fn(),
  }
  const bridge = new AiriBridge(client, eventBus)
  bridge.init()
  bridge.setCommandAvailable(options.commandAvailable ?? true)

  return { bridge, client, eventBus, handlers }
}

/**
 * @example
 * bridge.setCommandAvailable(true) lets a generic `spark:command` wake the Minecraft brain.
 */
describe('airiBridge spark command routing', () => {
  /**
   * @example
   * expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'signal:airi_command' }))
   */
  it('routes spark commands as AIRI commands instead of chat messages', () => {
    const { bridge, eventBus, handlers } = createBridgeHarness()
    const commandHandler = handlers.get('spark:command')

    expect(commandHandler).toBeDefined()

    commandHandler?.({
      data: {
        id: 'event-1',
        commandId: 'spark-1',
        intent: 'action',
        interrupt: false,
        priority: 'normal',
        guidance: {
          type: 'instruction',
          options: [
            {
              label: 'collect wood',
              steps: ['find a tree', 'chop it'],
            },
          ],
        },
      },
    })

    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'signal:airi_command',
      payload: expect.objectContaining({
        type: 'airi_command',
        description: 'Directive from AIRI: "collect wood"',
        sourceId: 'airi',
        metadata: expect.objectContaining({
          message: 'collect wood',
          sparkCommandId: 'spark-1',
          sparkIntent: 'action',
        }),
      }),
    }))
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'signal:chat_message',
    }))

    bridge.destroy()
  })

  /**
   * @example
   * expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'dropped' }) }))
   */
  it('drops relayed commands while no Minecraft bot runtime is active', () => {
    const { bridge, client, eventBus, handlers } = createBridgeHarness({ commandAvailable: false })
    const commandHandler = handlers.get('spark:command')

    commandHandler?.({
      data: {
        id: 'event-offline',
        commandId: 'spark-offline',
        intent: 'action',
        interrupt: false,
        priority: 'normal',
        guidance: {
          type: 'instruction',
          options: [
            {
              label: 'collect wood',
              steps: ['find a tree', 'chop it'],
            },
          ],
        },
      },
    })

    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({
        eventId: 'spark-offline',
        state: 'dropped',
        note: 'Minecraft bot is offline',
      }),
    }))
    expect(eventBus.emit).not.toHaveBeenCalled()

    bridge.destroy()
  })
})
