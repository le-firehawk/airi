/* eslint-disable no-template-curly-in-string */

import type { Configuration } from 'electron-builder'

import { execSync } from 'node:child_process'

import { isMacOS } from 'std-env'

function hasXcode26OrAbove() {
  if (!isMacOS)
    return false
  try {
    const output = execSync('xcodebuild -version')
      .toString()

      .match(/Xcode (\d+)/)
    if (!output)
      return false
    return Number.parseInt(output[1], 10) >= 26
  }
  catch {
    return false
  }
}

/**
 * Determine whether to use the .icon format for the macOS app icon based on the
 * Xcode version while building.
 * This is friendly to developers whose macOS and/or Xcode versions are below 26.
 */
const useIconFormattedMacAppIcon = hasXcode26OrAbove()
if (isMacOS && !useIconFormattedMacAppIcon) {
  console.warn('[electron-builder/config] Warning: Xcode version is below 26. Using .icns format for macOS app icon.')
}
else if (isMacOS) {
  // NOTICE: This success-path message intentionally uses stderr via `console.warn`.
  // The artifact metadata CLI imports this config and is used in GitHub Actions
  // command substitution for `GITHUB_ENV`; writing this log to stdout would break
  // machine-readable output such as `BUNDLE_NAME=$(...)`.
  console.warn('[electron-builder/config] Xcode version is 26 or above. Using .icon format for macOS app icon.')
}

export default {
  appId: 'ai.moeru.airi',
  productName: 'AIRI',
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  files: [
    'out/**',
    'resources/**',
    'package.json',
    // NOTICE: Exclude npm `electron` package from app payload.
    // Electron runtime is already provided by the outer app bundle; bundling a nested
    // `node_modules/electron/dist/Electron.app` makes electron-builder deep-sign it and
    // fails on non-code resources (for example `locale.pak`) with timestamp/signing errors.
    '!**/node_modules/electron{,/**}',
    // Workspace hoisting exposes build tools to electron-builder's file walk.
    // The packaged app has no runtime import of these tools.
    '!**/node_modules/@rolldown{,/**}',
    '!**/node_modules/rolldown{,/**}',
    '!**/node_modules/lightningcss{,/**}',
    '!**/node_modules/lightningcss-*{,/**}',
    '!**/node_modules/fsevents{,/**}',
    // Transformers runs inside browser workers in the desktop app. Sharp is its
    // Node-only image backend and has no packaged main-process consumer.
    '!**/node_modules/sharp{,/**}',
    '!**/node_modules/@img/sharp-*{,/**}',
    // uiohook-napi loads the selected prebuild. Its bundled libuiohook C source is
    // only used to build that binary and does not participate in runtime loading.
    '!**/node_modules/uiohook-napi/libuiohook{,/**}',
    '!**/.vscode/*',
    '!src/**/*',
    '!**/node_modules/**/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!**/node_modules/**/{.turbo,test,src,__tests__,tests,example,examples}',
    '**/node_modules/debug/**/*',
    '**/node_modules/superjson/**/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!vite.config.{js,ts,mjs,cjs}',
    '!uno.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.ts,.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json}',
  ],
  asar: true,
  asarUnpack: [
    '**/*.node',
    '**/node_modules/@auv-js/cli-*/bin/**',
  ],
  extraResources: [
    {
      from: '../../engines/stage-tamagotchi-godot/out/${os}',
      to: 'godot-stage',
      filter: ['**/*'],
    },
  ],
  extraMetadata: {
    name: 'ai.moeru.airi',
    main: 'out/main/index.js',
    homepage: 'https://airi.moeru.ai/docs/',
    repository: 'https://github.com/moeru-ai/airi',
    license: 'MIT',
  },
  win: {
    executableName: 'airi',
    // NOTICE: Keep `channel: 'latest-${arch}'` for architecture-aware updater metadata.
    // electron-builder expands `${arch}` at publish-time (for example: `latest-x64`, `latest-arm64`),
    // and electron-updater later consumes that expanded channel to resolve platform-specific *.yml files.
    // This prevents cross-arch lookups such as arm64 clients reading x64 metadata.
    publish: {
      provider: 'github',
      owner: 'moeru-ai',
      repo: 'airi',
      channel: 'latest-${arch}',
    },
  },
  nsis: {
    artifactName: '${productName}-${version}-windows-${arch}-setup.${ext}',
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    createDesktopShortcut: 'always',
    deleteAppDataOnUninstall: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    runAfterFinish: true,
  },
  mac: {
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // NOTICE: Same channel rule as Windows. Keep `${arch}` here so generated metadata resolves
    // to architecture-specific update feeds on macOS (for example: `latest-x64-mac.yml`, `latest-arm64-mac.yml`).
    publish: {
      provider: 'github',
      owner: 'moeru-ai',
      repo: 'airi',
      // Keep architecture in the channel so Apple Silicon never receives an x64 update.
      // The builder writes the expanded channel into app-update.yml. The updater appends the platform suffix and .yml.
      // Source: https://github.com/electron-userland/electron-builder/blob/ed422f36540a93e9bd2a19bc7a5e729bf2b033ea/packages/app-builder-lib/src/publish/updateInfoBuilder.ts#L65-L68
      // Runtime: https://github.com/electron-userland/electron-builder/blob/ed422f36540a93e9bd2a19bc7a5e729bf2b033ea/packages/electron-updater/src/providers/Provider.ts#L44-L60
      channel: 'latest-${arch}',
    },
    extendInfo: {
      NSAppleEventsUsageDescription: 'AIRI uses Automation to control apps for computer-use tasks.',
      NSMicrophoneUsageDescription: 'AIRI requires microphone access for voice interaction',
      NSSpeechRecognitionUsageDescription: 'AIRI uses Apple Speech to transcribe voice interactions on this device',
      NSCameraUsageDescription: 'AIRI requires camera access for vision understanding',
      NSBluetoothAlwaysUsageDescription: 'AIRI uses Bluetooth to read game controller input',
    },
    // For self-publishing, testing, and distribution after modified the code without access to
    // an Apple Developer account, comment and uncomment the following 4 lines.
    // Later on when you obtained one, you can set up the necessary certificates and provisioning
    // profiles to enable these security features.
    // hardenedRuntime: false,
    hardenedRuntime: true,
    // notarize: false,
    notarize: true,
    executableName: 'airi',
    icon: useIconFormattedMacAppIcon ? 'icon.icon' : 'icon.icns',
  },
  dmg: {
    artifactName: '${productName}-${version}-darwin-${arch}.${ext}',
  },
  linux: {
    syncDesktopName: true,
    target: [
      'deb',
      'rpm',
    ],
    // NOTICE: Same channel rule as Windows/macOS. Keep `${arch}` to avoid x64/arm64 feed collisions on Linux.
    publish: {
      provider: 'github',
      owner: 'moeru-ai',
      repo: 'airi',
      channel: 'latest-${arch}',
    },
    category: 'Utility',
    synopsis: 'AI VTuber/Waifu chatbot app inspired by Neuro-sama.',
    description: 'AIRI is an AI VTuber/Waifu chatbot supporting Live2D/VRM avatars, featuring human-like interactions and modular stage-based rendering.',
    executableName: 'airi',
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
    icon: 'build/icons/icon.png',
  },
  appImage: {
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
  npmRebuild: false,

} satisfies Configuration
