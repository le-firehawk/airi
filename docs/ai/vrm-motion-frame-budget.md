# VRM motion frame-budget regression

## Observed behavior

The installed Linux build showed held animation poses followed by large jumps. Normal idle and the return to idle remained smooth.
The supplied recording confirms roughly 0.74–0.88-second held poses during several motion sequences.
The recording does not identify the hardware or isolate one runtime cause.

## Source findings

`VRMModel.vue` updates the motion controller, humanoid, look-at, expressions, constraints, and spring bones before emitting its frame event.
`ThreeScene.vue` handles that event through `SceneMotionFraming.tick`.
Previously, active motion synchronously called `SkinnedMesh.computeBoundingBox` for every visible skinned mesh each 100 milliseconds.
That Three.js method calls `getVertexPosition` for every vertex, including CPU morphing and skinning.
The existing 500,000-visit limit bounded total work, but did not enforce a render-frame budget.
Idle skipped that scan. This explains an active-only CPU cost consistent with the report.

A second defect amplified slow frames.
`MotionController.update` advanced the action deadline by the full elapsed time, but advanced the mixer by at most 100 milliseconds.
An 800-millisecond frame therefore consumed 800 milliseconds of the action while playing only 100 milliseconds of its clip.
The controller could reach its deadline without playing most of the motion.

## Changes

- Capture one pose's root, mesh, bone, bind, instance, and morph state without copying vertex buffers.
- Deform that snapshot across frames with a 4,096-visit cap and a two-millisecond CPU slice.
- Check the clock every 64 vertices. Bound pose capture and instance processing too.
- Publish only complete bounds. Keep the previous complete sample while its replacement runs.
- Invalidate pending work after geometry, visibility, ownership, or lifecycle changes.
- Prime one reference sample during initial idle without changing the camera.
- Preserve camera anchors, manual ownership, hysteresis, and idle restoration.
- Advance clip time and action deadlines by the same elapsed time. Keep the movement integration step bounded.

Snapshots preserve Three.js skinning behavior, including unusual weights and active morphs.
They never mutate the live mesh's bounding box or skeleton.
Delayed geometry remains an explicitly limited framing result. It is not a guarantee against clipping between samples.

## Reproduction and measurements

Run from the repository root with the project's Node 26 toolchain:

```sh
AIRI_PROFILE_FRAMING=true pnpm -F @proj-airi/stage-ui-three exec vitest run src/companion/scene-motion-framing.performance.test.ts --silent=false --reporter=verbose
```

The fixture uses real Three.js skinned geometry with four nonzero bone influences per vertex.
The benchmark compares the previous full scan against the complete new adapter tick, including capture and validation.
These measurements came from the restricted execution environment on 2026-10-11. They are diagnostic, not device FPS claims.

| Vertices | Previous mean / peak | New mean / peak | New p95 | First complete sample at 60 Hz |
| --- | --- | --- | --- | --- |
| 50,000 | 20.44 / 22.00 ms | 1.74 / 2.12 ms | 2.12 ms | 13 frames, 200 ms |
| 250,000 | 92.84 / 97.21 ms | 1.56 / 2.09 ms | 1.79 ms | 62 frames, 1.02 s |
| 499,000 | 177.75 / 182.58 ms | 1.60 / 2.07 ms | 1.92 ms | 123 frames, 2.03 s |

The deterministic regression checks the maximum vertex work per rendered frame. It does not assert hardware-dependent timing thresholds.
A separate regression verifies that an 800-millisecond frame advances the mixer by 800 milliseconds.

## Limits and follow-up

First fitting still waits for a complete reference if playback starts before idle priming completes.
At the extreme fixture size, that takes about two seconds at 60 Hz and longer at lower render rates.
After priming, the heuristic reference permits immediate widening. Exact later bounds retain sampling latency.
The two-millisecond slice prioritizes animation responsiveness over immediate high-density geometry coverage.
Garbage collection, scheduling, and bounded capture work can exceed the nominal slice on a particular machine.

No Electron rendering or browser FPS verification ran in this environment. Browser launch remained sandbox-blocked.
No security setting was disabled to run the tests.
A real-device check must still confirm motion smoothness, gaze, initial framing, manual camera control, and idle restoration.
