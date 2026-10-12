# VRM motion runtime

This module provides a metadata catalog and an animation controller for one VRM avatar.
It includes original procedural motions without model files or third-party motion assets.

## Use

Use this runtime for body gestures, a selected idle, and short bounded locomotion.
Keep expression weights, lipsync, gaze, and spring bones in their existing VRM owners.

The host creates a dedicated movement group between its placement group and `vrm.scene`.
The controller captures that movement group's initial position and rotation.
Stage settings remain on the parent placement group.

```ts
import { MotionController } from '@proj-airi/stage-ui-three/motions'
import { Group } from 'three'

const movementRoot = new Group()
placementRoot.add(movementRoot)
movementRoot.add(vrm.scene)

const motions = new MotionController(vrm, originalIdleClip, movementRoot)
await motions.play('bow')
await motions.play('wave', { mode: 'queue' })

// Each frame, update the mixer before the VRM expression and physics owners.
motions.update(delta)
vrm.update(delta)
```

The supplied idle remains selected until `setIdle` succeeds.
`setIdle('default-idle')` restores the supplied idle.
`setIdle` accepts an idle entry or an imported clip without scene locomotion.
It preserves an active gesture and changes the idle that follows it.

## Catalog and loaders

`createMotionCatalog()` exposes metadata before any procedural code or animation asset loads.
The catalog includes 17 built-in motions:

- Idle: `natural-idle`, `attentive-idle`, and `thoughtful-idle`.
- Gestures: `bow`, `wave`, `nod`, `shake-head`, `celebrate`, `stretch`, `present`, `blow-kiss`, `laugh`, and `shrug`.
- Rhythm: `dance` and `head-bob`.
- Stage travel: `run-circle` and `walk-circle`.

Kiss and thoughtful gestures use measured hand targets near the head.
Laugh uses uneven body pulses and leaves facial expression and audio ownership unchanged.
The UI reads these entries from the shared catalog, including search, queue, and idle selection.
Fresh AI preferences include non-idle entries. Existing saved choices remain unchanged until the user selects additional motions.

Register imported motions with `catalog.register(metadata, loader)`.
Each loader receives the target `VRMCore` and an `AbortSignal`.
It returns an `AnimationClip` with normalized humanoid tracks for that avatar.
The caller retains ownership of files, asset URLs, and file permissions.

The catalog does not retain avatar-specific clips.
The controller retains at most eight cached source clips and sixteen queued requests.
Temporary mask and playback clips share immutable tracks with those sources.
The controller retains at most eight retiring actions, then releases each temporary clip and its mixer bindings.
A catalog replacement invalidates the old entry on the next request.
An in-flight result with an outdated revision cannot start playback.

## Playback and cleanup

- `play` replaces playback by default. Queue mode preserves the current request and appends another action.
- Repeated actions stop after fifteen seconds by default. Explicit deadlines cannot exceed sixty seconds.
- `stop` cancels pending requests, clears the queue, and blends back to the selected idle.
- `reset` returns immediately to idle for an invisible, detached avatar.
- `dispose` cancels requests, releases mixer bindings, and restores the temporary movement transform.
- A canceled request resolves false even if its asset transport cannot abort.
- `playResult` returns a request-specific rejection reason. UI messages distinguish readiness, camera interaction, missing clips, load failure, space, cancellation, and queue capacity.
- A failed load returns to idle and permits the next queued action to proceed.

Body transitions use a 0.3-second crossfade from each action's current effective weight.
Interrupted transitions preserve those weights and use matching fade deadlines.
A restart of a weighted motion uses a separate temporary instance, so the old pose remains available during the blend.
Circle motion starts with its tangent along the rest heading and returns smoothly to the captured transform.
Yaw stays within 180 degrees per second, with acceleration bounded at 540 degrees per second squared.
Stop and timeout preserve that bound while the controller brakes, reverses, and restores the exact rest orientation.
Without a stage binding, its radius cannot exceed 20% of the estimated humanoid height.
Height and leg lengths come from the normalized rest pose, independent of current poses or stage scale.

## Bounded stage travel

`VRMModel` binds the controller to the actual canvas size before accepting playback.
`VRMModel` reuses the complete bind-geometry box already computed for scene bootstrap.
It converts that world-space box into the stable placement root, including on cached-model reload.
`ThreeScene` can union complete idle geometry samples from the existing CPU-budgeted sampler.
Admission does not wait for a full CPU skinning pass on a high-polygon model.
The controller checks all playback sources after loading, including queued requests and explicit idle selection.
A saved idle selection waits for initial bounds. Replacement, reset, or disposal cancels that wait.
Missing bounds and insufficient space produce separate playback errors.

A stage-bound run moves the dedicated root through a camera-plane ellipse in two screen dimensions.
The path starts at the saved placement and uses the available inset canvas space.
A 12-pixel edge margin surrounds the conservative body envelope.
The path needs at least 24 horizontal and 16 vertical pixels of radius.
Explicit radius limits cannot turn a blocked run into an in-place jog.
Stride cadence sets travel speed.
Walking uses a 1.2-second cycle and 0.26 avatar heights of travel per cycle.
Running retains its 0.72-second cycle and 0.44 avatar heights per cycle.
The optional `strideLength` metadata uses avatar heights per complete gait cycle, bounded from 0.05 to 0.8.
Both gaits use the same admission checks, root owner, timeout, stop, queue, and resize handling. Tangent heading respects the camera and placement coordinate systems.
This is screen-plane travel. It does not simulate physical ground contact or move the native desktop window.

A run freezes automatic framing so its path cannot expand in response to its own camera movement.
Other motions retain the existing CPU-budgeted framing path after admission.
Resize and camera changes recheck the active motion without overwriting saved placement or camera controls.
If a smaller viewport cannot fit the motion, playback and its queue stop immediately.
Ordinary stop and completion still blend back smoothly.
If a selected imported idle no longer fits, the supplied idle preserves the existing view.

Built-in envelopes reserve limb, bob, and turning-silhouette clearance around the load-time bind-geometry reference.
Imported clips use a much wider articulation estimate, including the sanitized hips-translation limit.
Thoughtful idle reserves extra forward clearance for its raised forearm.
These envelopes are conservative estimates, not sampled swept-pose guarantees.
Unusual proportions, props, clothing, morphs, and secondary physics still require visual checks.
The solver never changes the camera to make a rejected motion pass.
Users can enlarge the stage or zoom out before retrying.
The explicit Fit model for motion action fits built-in envelopes and validates circle clearance before applying a new view.
It reads the current canvas size before fitting, including a resize that has not reached the next rendered frame.
A successful fit preserves bounds readiness so the resize panel retains its result.
It preserves the lens, orientation, and model placement, and uses a full-body orbit pivot.
A failed fit leaves the close-up unchanged. A successful fit stops playback, game ownership, and pending notification reactions.

## Track ownership

The controller accepts only normalized humanoid quaternion tracks and the hips position track.
It removes eye, jaw, expression, material, scale, and scene-transform tracks.
It anchors imported hips motion to the rest position and bounds horizontal and vertical displacement.
The source clip remains unchanged.

For a partial-body motion, a temporary idle companion contains only tracks absent from the motion.
The two track sets are disjoint. The selected idle cannot dilute the motion on its owned bones.
The companion retains the idle phase and normal playback rate, including during faster motion loops.
A changed idle replaces the companion without restarting the gesture.
A cached motion receives a fresh mask against the selected idle on each playback.

Procedural bow, dance, and idle motions use a two-link leg solution to preserve each ankle position.
The circle motion combines alternating strides, knee flexion, foot movement, arm swings, and pelvis counterrotation.
Upper-leg swing stays within 0.52 radians. The hips bob stays within 2.4% of the estimated humanoid height.
These bounds limit motion displacement. Avatar proportions, clothing, and spring settings still require visual checks.
Walking uses alternating support and swing phases with planted-foot leg solutions and a lower pelvis during long steps.
Its first hips offset is zero, so body-track anchoring preserves the support height.
Loop endpoints match, including the breathing idles and rhythmic head motion.
Optional bones are omitted when the avatar does not provide them.

## Joint geometry

Built-in poses use anatomical axes measured from the normalized rest skeleton.
This supports VRM 0 and VRM 1 facing directions, angled arm rests, and different raw bone axes.
Current playback, stage rotation, and stage scale do not change these measurements.

Arm targets separate elevation, forward swing, longitudinal twist, and elbow flexion.
Each elbow uses one anatomical hinge, with flexion bounded between 0.04 and 2.2 radians.
Above 60 degrees, optional clavicles share arm elevation, up to 0.45 radians.
Rigs without clavicles retain the requested hand direction.
Near-head gestures use a bounded two-link arm solution and an outward elbow pole.
The solver measures head and arm rest points without reading current playback or stage transforms.
It shares raised-arm elevation with available clavicles, then accounts for the resulting shoulder translation.
General reach limits normalized elbow flexion to 2 radians.
Kiss and thoughtful poses explicitly permit up to 2.35 radians to reach the lower face without stretching the arm.
Their raw-joint tests allow up to 2.55 radians after authored forearm constraints.
Every existing motion retains its original elbow limit and test bounds.
Unreachable targets clamp to the selected reach range rather than stretching either bone.
These limits require posed-mesh checks for each model. A numeric pass does not establish skin or clothing quality.
Knee bends use the same anatomical frame, including avatars that face the opposite direction.

The bundled 48-second Relaxed arms idle retains its body and finger tracks.
Only its shoulder, arm, and hand tracks use the measured relaxed pose.
User-imported clips retain their authored rotations.
The runtime leaves model geometry, skin weights, node constraints, and spring settings unchanged.
Authored constraints can change the final raw bone positions after the normalized pose.
Avatar clothing and skin deformation still require checks with the actual model.

## Checks

From the repository root:

```sh
pnpm -F @proj-airi/stage-ui-three exec vitest run src/motions/controller.test.ts src/motions/procedural-joints.test.ts
pnpm -F @proj-airi/stage-ui-three typecheck
pnpm lint
```

The tests use real normalized VRM rigs without a renderer or a model asset.
They cover lazy catalogs, resource limits, queue order, cancellation, root movement, track filtering, planted feet at different scales, anatomical joint limits, rest-pose variants, and authored forearm constraints.
