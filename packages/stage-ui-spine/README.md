# @proj-airi/stage-ui-spine

Spine 2D scene components and stores for Project AIRI. Provides Vue components, composables, and utilities for rendering and managing Spine animations within the stage UI.

## Prerequisites

**You must hold a valid [Spine Editor license](https://esotericsoftware.com/spine-purchase) (Essential, Professional, or Enterprise) to develop with this package.**

The Spine Runtimes (`@esotericsoftware/spine-webgl`) are provided under the [Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license), which requires each developer integrating the runtimes to hold their own Spine Editor license at the time of integration.

End users of a shipped product that uses Spine animations do not need their own Spine license.

## Usage

```ts
import { SpineScene } from '@proj-airi/stage-ui-spine/components/scenes'
import { useSpineStore } from '@proj-airi/stage-ui-spine/stores/spine'
```

## Runtime ownership

The loader selects a separate adapter for Spine 4.0, 4.1, or 4.2. Each adapter keeps its SDK objects together.
The scene and ZIP preview use the same canvas lifecycle. AIRI owns asset readiness and the animation-frame loop.

Disposal cancels pending frames and releases model assets, background textures, and renderer resources.
A WebGL context-loss event stops the current canvas. A restored context cannot restart a disposed canvas.
The ZIP preview releases its canvas after capture, an error, or its four-second timeout.

Run the browser regressions with Chromium installed:

```sh
pnpm exec vitest run --config packages/stage-ui-spine/vitest.config.ts --project stage-ui-spine:browser
```

These tests cover all three versions, including their different blending and world-transform APIs.

## License

- **Original code** (components, stores, composables, utilities): MIT License
- **Spine Runtimes** (`@esotericsoftware/spine-webgl`): [Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license)

See [LICENSE.md](./LICENSE.md) for full details.
