import type { Entity } from 'prismarine-entity'

import type { ReflexBehavior } from '../types/behavior'

import { attackEntity } from '../../../skills/combat'
import { isHostile } from '../../../utils/mcdata'
import { recentAttacker } from '../../perception/events/definitions/attacker-tracker'

// Dominates idle-gaze; sits just below auto-eat (1000) so eating at critical health still wins.
const SCORE = 900

// Guards against re-entry: the reflex tick can re-fire while attackEntity is still in flight, and we
// must not start a second pvp engagement on top of the first.
let combatInFlight = false

/**
 * Whether the bot should auto-defend against this attacker.
 *
 * Use when:
 * - Deciding, in the defend reflex, whether the entity that just hurt the bot is something to fight.
 *
 * Returns:
 * - true only for hostile mobs. NEVER players (so the master — or any player — is never attacked by
 *   the reflex; player threats are left to the conscious brain), and null/environmental damage is
 *   ignored. Because the trigger is "this entity actually dealt us damage", passive animals (which
 *   never attack) are inherently excluded.
 */
export function isEngageableMob(attacker: { type?: string, name?: string } | null | undefined): boolean {
  if (!attacker)
    return false
  if (attacker.type === 'player')
    return false
  return isHostile(attacker as Entity)
}

/**
 * Defense reflex: when a hostile mob attacks the bot, engage and kill it — and HOLD the engagement
 * (attackEntity runs to completion) instead of leaving combat to the brain, which thrashed between
 * attacking and fleeing on every hit and got the bot killed. Only reacts to mobs that actually dealt
 * damage (via the attacker tracker), so it never picks fights with passive animals or players.
 * Suppresses auto-follow for the duration (reflexEngaged) so the follow goal does not fight the pvp
 * chase.
 */
export const defendBehavior: ReflexBehavior = {
  id: 'defend',
  // Survival overrides whatever else the bot is doing, in any mode.
  modes: ['idle', 'social', 'alert', 'wander', 'work'],
  when: (ctx) => {
    if (combatInFlight)
      return false
    // Wait for the active reflex to finish. Equipping a weapon here can cancel eating or escape actions. A remaining attacker triggers defense on the next tick.
    if (ctx.autonomy.reflexEngaged)
      return false
    return isEngageableMob(recentAttacker(Date.now()))
  },
  score: () => SCORE,
  run: async (api) => {
    const attacker = recentAttacker(Date.now())
    if (!isEngageableMob(attacker))
      return

    combatInFlight = true
    // Let the pvp chase own the pathfinder; auto-follow yields until combat ends.
    api.context.updateAutonomy({ reflexEngaged: true })
    try {
      // Resolve the live entity instead of treating attribution metadata as a complete entity.
      const entity = attacker?.id == null ? undefined : api.bot.bot.entities[Number(attacker.id)]
      if (entity)
        await attackEntity(api.bot, entity, true)
    }
    catch {
      // Mob despawned / unreachable / fight interrupted — the next tick re-evaluates.
    }
    finally {
      combatInFlight = false
      api.context.updateAutonomy({ reflexEngaged: false })
    }
  },
}
