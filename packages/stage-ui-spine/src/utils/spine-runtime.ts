import type { SpineCanvasFactory } from './spine-canvas'
import type { SpineVersion } from './spine-version'

/** Loads the adapter that owns the selected SDK version and its canvas lifecycle. */
export async function loadSpineRuntime(version: SpineVersion): Promise<{ createCanvas: SpineCanvasFactory }> {
  switch (version) {
    case '4.0':
      return await import('./spine-runtime-4-0')
    case '4.1':
      return await import('./spine-runtime-4-1')
    case '4.2':
      return await import('./spine-runtime-4-2')
  }
}
