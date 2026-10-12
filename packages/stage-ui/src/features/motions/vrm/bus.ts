import type { MotionPlayResult } from '@proj-airi/stage-ui-three/motions'

import type { MotionCommand } from './command'

import { defineEventa } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/broadcast-channel'

export type { MotionCommand } from './command'

export const motionCommand = defineEventa<MotionCommand>('airi:vrm-motion:command')
export const motionLibraryChanged = defineEventa('airi:vrm-motion:library-changed')
export const motionPreferencesChanged = defineEventa<{ modelId: string }>('airi:vrm-motion:preferences-changed')
/** Only the matching model and request consume an admission result. Rejections carry request-local reasons. */
export type MotionCommandResult = { modelId: string, requestId: string } & (MotionPlayResult | { accepted: false, reason: 'paused' | 'interaction-busy' | 'invalid-command' })
export const motionCommandResult = defineEventa<MotionCommandResult>('airi:vrm-motion:command-result')

let context: ReturnType<typeof createContext>['context'] | undefined

/** Reuses one Eventa transport per renderer. No animation bytes cross this channel. */
export function getMotionBus() {
  if (!context)
    context = createContext(new BroadcastChannel('proj-airi:vrm-motions')).context
  return context
}
