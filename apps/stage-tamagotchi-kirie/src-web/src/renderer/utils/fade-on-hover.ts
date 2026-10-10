/**
 * Resolves the visual and native input behavior for Auto Hide outside interactive controls.
 * A faded stage must ignore mouse events so its invisible pixels cannot block the app below.
 */
export function resolveFadeOnHoverInteraction(params: {
  cursorInsideWindow: boolean
  enabled: boolean
  transparentForFade: boolean
  transparentForPointer: boolean
}) {
  const fadeStage = params.enabled
    && params.cursorInsideWindow
    && !params.transparentForFade

  // NOTICE:
  // Fade sampling differs from exact-pixel hit-testing. Faded model pixels can remain opaque to native pointer tests.
  // Enable click-through while faded so invisible content cannot block applications.
  // Source: apps/stage-tamagotchi/src/renderer/pages/index.vue transparency samplers.
  // Remove when fading no longer covers interactive pixels.
  return {
    fadeStage,
    ignoreMouseEvents: params.enabled
      && (fadeStage || params.transparentForPointer),
  }
}
