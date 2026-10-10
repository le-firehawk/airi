import type { Client, ContextUpdate, ModuleAnnouncedEvent } from '@proj-airi/server-sdk'

import type { EventBus } from '../cognitive/event-bus'

import { useLogg } from '@guiiai/logg'
import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

interface SparkCommandData {
  commandId: string
  intent: 'plan' | 'proposal' | 'action' | 'pause' | 'resume' | 'reroute' | 'context'
  interrupt: 'force' | 'soft' | false
  priority: 'critical' | 'high' | 'normal' | 'low'
  guidance?: {
    options?: Array<{ label: string, steps: string[] }>
  }
}

/**
 * Connects the Minecraft cognitive runtime to AIRI server events.
 *
 * Use when:
 * - Minecraft must publish context and notifications to Stage runtimes.
 * - Generic `spark:command` events must wake the Minecraft decision loop.
 *
 * Expects:
 * - {@link init} is called once before events are exchanged.
 * - {@link setCommandAvailable} follows the active bot lifecycle.
 *
 * Returns:
 * - Event handlers and send operations for the Minecraft side of the AIRI server seam.
 */
export class AiriBridge {
  private readonly logger = useLogg('airi-bridge').useGlobalConfig()
  private commandAvailable = false
  private commandHandler: ((event: { data: SparkCommandData }) => void) | null = null
  private contextUpdateHandler: ((event: { data: ContextUpdate }) => void) | null = null
  private moduleAnnouncedHandler: ((event: { data: ModuleAnnouncedEvent }) => void) | null = null
  private readonly moduleAnnouncedListeners = new Set<(event: ModuleAnnouncedEvent) => void>()

  constructor(
    private readonly client: Pick<Client, 'send' | 'onEvent' | 'offEvent'>,
    private readonly eventBus: Pick<EventBus, 'emit'>,
  ) {}

  init(): void {
    this.commandHandler = (event) => {
      const cmd = event.data
      this.logger.log('Received spark:command', { intent: cmd.intent, commandId: cmd.commandId })

      if (!this.commandAvailable) {
        this.sendEmit(cmd.commandId, 'dropped', 'Minecraft bot is offline')
        return
      }

      this.sendEmit(cmd.commandId, 'queued', 'Command received')

      // Every spark:command wakes the decision loop, including commands labeled context. Passive context:update events remain history-only.
      this.handleActionIntent(cmd)
    }

    this.contextUpdateHandler = (event) => {
      const ctx = event.data
      this.logger.log('Received context:update', { lane: ctx.lane, preview: ctx.text.slice(0, 80) })

      this.eventBus.emit({
        type: 'signal:airi_context',
        payload: Object.freeze({
          type: 'airi_context' as const,
          description: ctx.text,
          sourceId: 'airi',
          confidence: 1.0,
          timestamp: Date.now(),
          metadata: {
            source: 'airi',
            contextId: ctx.contextId,
            lane: ctx.lane ?? 'general',
            hints: ctx.hints ?? [],
          },
        }),
        source: { component: 'airi', id: 'bridge' },
      })
    }

    this.moduleAnnouncedHandler = (event) => {
      const moduleAnnouncement = event.data
      this.logger.log('Received module:announced', { name: moduleAnnouncement.name, pluginId: moduleAnnouncement.identity?.plugin?.id })
      for (const listener of this.moduleAnnouncedListeners) {
        listener(moduleAnnouncement)
      }
    }

    this.client.onEvent('spark:command', this.commandHandler as Parameters<typeof this.client.onEvent<'spark:command'>>[1])
    this.client.onEvent('context:update', this.contextUpdateHandler as Parameters<typeof this.client.onEvent<'context:update'>>[1])
    this.client.onEvent('module:announced', this.moduleAnnouncedHandler as Parameters<typeof this.client.onEvent<'module:announced'>>[1])
    this.logger.log('AiriBridge initialized, listening for spark:command, context:update, and module:announced')
  }

  destroy(): void {
    if (this.commandHandler) {
      this.client.offEvent('spark:command', this.commandHandler as Parameters<typeof this.client.offEvent<'spark:command'>>[1])
      this.commandHandler = null
    }
    if (this.contextUpdateHandler) {
      this.client.offEvent('context:update', this.contextUpdateHandler as Parameters<typeof this.client.offEvent<'context:update'>>[1])
      this.contextUpdateHandler = null
    }
    if (this.moduleAnnouncedHandler) {
      this.client.offEvent('module:announced', this.moduleAnnouncedHandler as Parameters<typeof this.client.offEvent<'module:announced'>>[1])
      this.moduleAnnouncedHandler = null
    }
    this.moduleAnnouncedListeners.clear()
    this.logger.log('AiriBridge destroyed')
  }

  sendNotify(headline: string, note?: string, urgency: 'immediate' | 'soon' | 'later' = 'soon'): void {
    this.client.send({
      type: 'spark:notify',
      data: {
        id: nanoid(),
        eventId: nanoid(),
        kind: 'ping',
        urgency,
        headline,
        note,
        destinations: ['proj-airi:stage-*'],
      },
    } as Parameters<typeof this.client.send>[0])
    this.logger.log('Sent spark:notify', { headline, urgency })
  }

  sendContextUpdate(text: string, hints?: string[], lane?: string): void
  sendContextUpdate(update: ContextUpdate): void
  sendContextUpdate(textOrUpdate: string | Omit<ContextUpdate, 'strategy' | 'id' | 'contextId'> & { contextId?: string }, hints?: string[], lane = 'game'): void {
    const update = typeof textOrUpdate === 'string'
      ? {
        text: textOrUpdate,
        hints,
        lane,
        strategy: ContextUpdateStrategy.AppendSelf,
      } satisfies Omit<ContextUpdate, 'id' | 'contextId'> & { contextId?: string }
      : {
          strategy: ContextUpdateStrategy.AppendSelf,
          ...textOrUpdate,
        }

    const contextId = update.contextId ?? nanoid()
    this.client.send({
      type: 'context:update',
      data: {
        id: nanoid(),
        contextId,
        lane: update.lane,
        text: update.text,
        hints: update.hints,
        strategy: update.strategy,
        destinations: update.destinations,
      },
    } as Parameters<typeof this.client.send>[0])
    this.logger.log('Sent context:update', { lane: update.lane, preview: update.text.slice(0, 80), contextId })
  }

  sendEmit(eventId: string, state: 'queued' | 'working' | 'done' | 'dropped', note?: string): void {
    this.client.send({
      type: 'spark:emit',
      data: {
        id: nanoid(),
        eventId,
        state,
        note,
      },
    } as Parameters<typeof this.client.send>[0])
    this.logger.log('Sent spark:emit', { eventId, state })
  }

  /** Enables command delivery only while a Minecraft bot runtime can consume it. */
  setCommandAvailable(available: boolean): void {
    this.commandAvailable = available
  }

  onModuleAnnounced(listener: (event: ModuleAnnouncedEvent) => void) {
    this.moduleAnnouncedListeners.add(listener)

    return () => {
      this.moduleAnnouncedListeners.delete(listener)
    }
  }

  private handleActionIntent(cmd: SparkCommandData): void {
    // The airi_command signal starts a fresh decision cycle with AIRI as its neutral source. Stage receives relay availability separately. This bridge enforces receiver availability.
    const firstOption = cmd.guidance?.options?.[0]
    const label = firstOption?.label?.trim()
    const steps = firstOption?.steps ?? []
    // Prefer the short label (closest to the original instruction). Fall back to joined steps so the
    // brain still has detail when label is missing.
    const message = label && label.length > 0
      ? label
      : (steps.length > 0 ? steps.join(' / ') : `${cmd.intent} command received`)

    const sourceId = 'airi'

    this.logger.log('Routing spark:command as an AIRI directive', {
      commandId: cmd.commandId,
      message,
    })

    this.eventBus.emit({
      type: 'signal:airi_command',
      payload: Object.freeze({
        type: 'airi_command' as const,
        description: `Directive from AIRI: "${message}"`,
        sourceId,
        confidence: 1.0,
        timestamp: Date.now(),
        metadata: {
          message,
          // Keep the spark provenance for debugging; the brain sees a typed AIRI directive.
          sparkCommandId: cmd.commandId,
          sparkIntent: cmd.intent,
        },
      }),
      source: { component: 'airi', id: 'bridge' },
    })
  }
}
