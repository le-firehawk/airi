# Renderer warning review

Source run: [Linux build 38017667646](https://github.com/le-firehawk/airi/actions/runs/38017667646/job/114111461965).

## Browser test fixture corrections

- The startup fixture now answers Home Assistant configuration and IO trace state requests.
  Missing handlers left those requests pending until teardown aborted their transports.
  Assertions cover both requests and completion of the Home Assistant refresh action.
- The painted-mask dialog fixture now supplies a Reka title and description.
  Assertions verify both accessible label references.
- The interaction fixtures now register the `/settings` route used by their real links.
- Chat layout fixtures now use render functions instead of runtime template strings.
  This removes their dependency on the runtime template compiler that emitted the `decodeEntities` warning.

These changes preserve the real components, transports, layout assertions, and teardown order.
They do not filter console messages or change application behavior.

## Remaining notification: Virtua resize delivery

The run emitted `ResizeObserver loop completed with undelivered notifications.` during chat layout tests.
The [Virtua 0.50.4 README](https://cdn.jsdelivr.net/npm/virtua@0.50.4/README.md) documents this exact notification.
Its [Vue bundle](https://cdn.jsdelivr.net/npm/virtua@0.50.4/lib/vue/index.js) connects its measurement callback directly to native ResizeObserver.
The [ResizeObserver specification](https://www.w3.org/TR/resize-observer/#deliver-resize-error) defines the notification for undelivered observations.

This evidence does not establish an AIRI-owned infinite layout loop.
AIRI already schedules its tail scrolling and history fade updates on animation frames.
The notification remains visible. Virtualization timing remains unchanged.

Next, run the browser suite and inspect scrolling, streaming, composer expansion, and repeated viewport changes.
If a persistent loop occurs, capture the responsible observer and dimensions before changing its scheduling.

## Remaining limitation: renderer Content Security Policy

The renderer HTML has no active Content Security Policy (CSP).
Its old policy is commented out.
The smoke test launches the development Electron binary, which exposes the security warning.
[Electron documents](https://www.electronjs.org/docs/latest/tutorial/security#electron-security-warnings) that packaged applications normally omit these warnings.
Packaging does not install a missing policy.

The [Electron warning implementation](https://github.com/electron/electron/blob/main/shell/renderer/security_warnings.cc) checks whether CSP restricts JavaScript evaluation.
Its [regression suite](https://github.com/electron/electron/blob/main/spec/security-warnings.spec.ts) accepts a policy that blocks evaluation but permits inline scripts.
That example does not establish sufficient protection for AIRI's extension content.

The execution contexts have different requirements:

1. Kokoro and background removal construct module workers with `new URL(...worker.ts, import.meta.url)`.
   Electron Vite emits ES worker assets. Neither constructor uses a blob/data URL or an inline-worker import.
   [Worker CSP rules](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy) give ordinary worker scripts their own policy.
   Blob and data workers instead inherit the creator's policy.
   A strict document policy therefore does not automatically restrict these two module workers.
2. Renderer stores import VAD directly. Silero does not specify a device, so Transformers 3.8.1 selects the `wasm` execution provider.
   The `workers/vad` directory does not isolate inference: its manager reexports state helpers, and its audio worklet only buffers samples.
   That provider choice does not select the plain WASM-only JavaScript module.
   The [Transformers web backend](https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/src/backends/onnx.js) imports `onnxruntime-web` and sets its default runtime directory to the Transformers CDN.
   [ONNX Runtime 1.27.0 exports](https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/package.json) select `ort.bundle.min.mjs`, which uses JSEP assets.
   The normal remote module is [Transformers 3.8.1's JSEP loader](https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.mjs).
   Its `Qb` generator calls `de`, which invokes the `Function` constructor through `apply`.
   The separate [ONNX Runtime 1.27.0 JSEP loader](https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.mjs) uses `Pb`, registered as WebAssembly import `r`, and `new Function`.
   In that second file, `Qb` releases handles.
   These generators require JavaScript evaluation when invoked.
   Whether Silero initialization or inference invokes them remains untested.
3. The extension host accepts `srcdoc` documents. Its default sandbox includes `allow-scripts` and `allow-same-origin`.
   A repository-wide search found no shipped `srcdoc` producer or script-source list.
   The SDK uses `assetPath` or `src`. User-installed plugin content remains unknown.
   A strict parent policy also constrains inline scripts inside `srcdoc` documents.
   A blanket inline allowance for hypothetical extensions does not establish a safe trust boundary.

The exact unverified paths are renderer VAD under a no-eval policy and externally supplied extension documents under a no-inline policy.
Neither the static worker constructors nor the existence of a JSEP generator proves that every inference path needs a runtime rebuild.

The [Emscripten invoker implementation](https://github.com/emscripten-core/emscripten/blob/main/src/lib/libemval.js) includes a closure-based `DYNAMIC_EXECUTION=0` branch.
[ONNX Runtime's build configuration](https://github.com/microsoft/onnxruntime/blob/main/cmake/onnxruntime_webassembly.cmake) forwards `onnxruntime_EMSCRIPTEN_SETTINGS` as Emscripten flags.
This is a supported source-build path, not a runtime option in the published package.

Next steps:

1. Run renderer VAD initialization and scoring under a candidate document CSP. Record CSP violations and runtime requests.
2. Where the policy blocks the JSEP invoker, build matching assets with `DYNAMIC_EXECUTION=0` and retain WebGPU support.
3. Exercise WASM and WebGPU inference with a policy that permits `wasm-unsafe-eval` but blocks JavaScript evaluation.
4. Verify real extension documents, workers, imported media, and configured HTTP(S)/WebSocket provider endpoints under that policy.
5. Enforce the policy after compatibility and extension isolation pass those checks.

No CSP or security preferences changed in this warning correction.
No minified ONNX runtime was patched.

## Verification boundary

Targeted ESLint and TypeScript syntax checks cover the edited test files.
Browser execution and full workspace typechecks were not run locally because the available environment cannot support this test setup.
Candidate CI must run them.
The no-eval VAD initialization and scoring check remains unrun.
