import { defineInvokeEventa } from '@moeru/eventa'

/** The main window reports real native sizes in logical display pixels, independent of display scale. */
export interface StageWindowSizeState {
  width: number
  height: number
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  /** Converts renderer client-coordinate distances to logical display pixels. */
  zoomFactor: number
  /** The compositor owns window placement and can reject programmatic resizing. */
  wayland: boolean
}

export const stageWindowGetSize = defineInvokeEventa<StageWindowSizeState>('eventa:invoke:electron:windows:main:size:get')
export const stageWindowSetSize = defineInvokeEventa<StageWindowSizeState, { width: number, height: number }>('eventa:invoke:electron:windows:main:size:set')
