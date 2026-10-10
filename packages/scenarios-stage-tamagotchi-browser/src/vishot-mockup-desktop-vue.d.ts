import type { Component } from 'vue'

declare module '@vishot/mockup-desktop-vue' {
  // NOTICE:
  // Vishot 0.0.3 exports these components but omits declarations for nested barrels.
  // Source: @vishot/mockup-desktop-vue/dist/components.js and dist/components/index.d.ts.
  // Remove this augmentation when Vishot publishes complete component declarations.
  export const DecoFocusMask: Component
  export const DecoHighlightRegion: Component
  export const DecoOutlineRegion: Component
  export const DecoProvider: Component
  export const RouterCaptureRoot: Component
  export const RouterProvider: Component
  export const ScenarioCanvas: Component
  export const ScreenNavigator: Component
  export function useSceneReady(sources: string[]): void
}
