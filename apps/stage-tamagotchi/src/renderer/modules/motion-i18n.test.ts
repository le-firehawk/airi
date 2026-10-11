import { readFileSync } from 'node:fs'

import { all } from '@proj-airi/i18n'
import { builtinMotionMetadata } from '@proj-airi/stage-ui-three/motions'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

import * as v from 'valibot'

interface Messages { [key: string]: string | Messages }
const messagesSchema: v.GenericSchema<Messages> = v.record(v.string(), v.union([v.string(), v.lazy(() => messagesSchema)]))
const locales = Object.keys(all)
const sourceLocales = new URL('../../../../../packages/i18n/src/locales/', import.meta.url)
// Read current source messages so a stale package build cannot hide a misplaced key.
const messages = Object.fromEntries(locales.map(locale => [locale, {
  settings: v.parse(messagesSchema, parse(readFileSync(new URL(`${locale}/settings.yaml`, sourceLocales), 'utf8'))),
  tamagotchi: {
    settings: v.parse(messagesSchema, parse(readFileSync(new URL(`${locale}/tamagotchi/settings.yaml`, sourceLocales), 'utf8'))),
  },
}]))
const expectedMessages = {
  'settings.vrm.motions.title': 'Motion Library',
  'settings.vrm.motions.description': 'Play body motions, import VRMA files, and choose an idle for each avatar. Speech and facial expressions stay independent.',
  'settings.vrm.motions.names.natural-idle': 'Natural idle',
  'settings.vrm.motions.names.relaxed-idle': 'Relaxed arms idle',
  'settings.vrm.motions.names.bow': 'Bow',
  'settings.vrm.motions.names.dance': 'Dance',
  'settings.vrm.motions.names.run-circle': 'Run in a circle',
  'settings.vrm.motions.names.wave': 'Wave',
  'settings.vrm.motions.names.nod': 'Nod',
  'settings.vrm.motions.names.shake-head': 'Shake head',
  'settings.vrm.motions.names.celebrate': 'Celebrate',
  'settings.vrm.motions.names.stretch': 'Stretch',
  'settings.vrm.motions.names.present': 'Present',
  'settings.vrm.motions.names.blow-kiss': 'Blow a kiss',
  'settings.vrm.motions.names.laugh': 'Laugh',
  'settings.vrm.motions.names.head-bob': 'Head bob',
  'settings.vrm.motions.names.walk-circle': 'Walk in a circle',
  'settings.vrm.motions.names.shrug': 'Shrug',
  'settings.vrm.motions.names.attentive-idle': 'Attentive idle',
  'settings.vrm.motions.names.thoughtful-idle': 'Thoughtful idle',
  'settings.vrm.motions.default-idle': 'Default idle',
  'settings.vrm.motions.idle': 'Idle motion',
  'settings.vrm.motions.idle-description': 'This choice is saved for this avatar. Select Default idle to restore AIRI\'s original motion.',
  'settings.vrm.motions.ai-enabled': 'Let the assistant play motions',
  'settings.vrm.motions.ai-selected': 'Allow this motion in chat',
  'settings.vrm.motions.ai-selection-description': 'Select up to 32 motions for the assistant. The full library stays available for manual playback.',
  'settings.vrm.motions.ai-limit': 'Select no more than 32 chat motions.',
  'settings.vrm.motions.search': 'Search motions',
  'settings.vrm.motions.select': 'Motion',
  'settings.vrm.motions.previous': 'Previous',
  'settings.vrm.motions.next': 'Next',
  'settings.vrm.motions.results': '{count} motions \u00B7 Page {page}',
  'settings.vrm.motions.loop': 'Repeat motion',
  'settings.vrm.motions.speed': 'Playback speed',
  'settings.vrm.motions.duration': 'Maximum duration in seconds',
  'settings.vrm.motions.play': 'Play',
  'settings.vrm.motions.queue': 'Add to queue',
  'settings.vrm.motions.stop': 'Stop and return to idle',
  'settings.vrm.motions.remove': 'Remove imported motion',
  'settings.vrm.motions.confirm-remove': 'Remove this motion from the local library?',
  'settings.vrm.motions.cancel': 'Cancel',
  'settings.vrm.motions.import': 'Import VRMA files',
  'settings.vrm.motions.import-description': 'Choose self-contained .vrma files up to 16 MB each. Files stay on this device. Import only motions you have permission to use.',
  'settings.vrm.motions.choose-files': 'Choose VRMA files',
  'settings.vrm.motions.imported': 'Imported {count} motions.',
  'settings.vrm.motions.requested': 'Motion requested. Open the VRM stage or preview to play it.',
  'settings.vrm.motions.accepted': 'Motion accepted.',
  'settings.vrm.motions.rejected': 'Motion unavailable or queue full.',
  'settings.vrm.motions.error': 'Motion error',
  'settings.vrm.motions.errors.format': 'Choose a valid binary VRMA animation file.',
  'settings.vrm.motions.errors.size': 'The animation exceeds the file size or decoded motion complexity limit.',
  'settings.vrm.motions.errors.external': 'This animation references external files. Export a self-contained VRMA file.',
  'settings.vrm.motions.errors.animation': 'No valid body animation was found. The maximum clip length is 10 minutes.',
  'settings.vrm.motions.errors.missing': 'The animation file is no longer in the local library.',
  'settings.vrm.motions.errors.interpolation': 'Only linear keyframes are supported. Export this animation with linear keyframes.',
  'settings.vrm.orbit-pivot.reset': 'Reset orbit center',
  'settings.vrm.orbit-pivot.loading': 'Finding orbit center…',
  'settings.vrm.orbit-pivot.error': 'Orbit center lookup failed. Try another point.',
  'settings.vrm.orbit-pivot.hint': 'Middle-click the model to center rotation on that point. Middle-drag still zooms.',
  'tamagotchi.settings.desktop-companion.reactions.description': 'Allow high-priority notifications to request an avatar reaction.',
}

describe('motion library translations', () => {
  // ROOT CAUSE:
  // Motion and pivot labels were nested under live2d, but every consumer requests settings.vrm keys.
  // Moving the complete blocks into vrm restores English labels and the existing locale fallback.
  it.each(locales)('resolves all motion labels and the reaction description in %s', (locale) => {
    const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages, missingWarn: false, fallbackWarn: false })
    try {
      for (const [key, english] of Object.entries(expectedMessages)) {
        expect(i18n.global.te(key, 'en'), key).toBe(true)
        const translated = i18n.global.t(key, { count: 3, page: 2 })
        expect(translated, key).not.toBe(key)
        expect(translated.trim(), key).not.toBe('')
        if (locale === 'en' || !i18n.global.te(key, locale))
          expect(translated, key).toBe(english.replaceAll('{count}', '3').replaceAll('{page}', '2'))
      }
      for (const entry of builtinMotionMetadata) {
        const key = `settings.vrm.motions.names.${entry.id}`
        expect(Object.hasOwn(expectedMessages, key), key).toBe(true)
        expect(i18n.global.t(key, {}, { locale: 'en' }), key).toBe(entry.name)
        expect(i18n.global.t(key), key).not.toBe(key)
        if (!i18n.global.te(key, locale))
          expect(i18n.global.t(key), key).toBe(entry.name)
      }
      const title = v.parse(v.object({ vrm: v.object({ title: v.string() }) }), messages[locale].settings).vrm.title
      expect(i18n.global.t('settings.vrm.title')).toBe(title)
    }
    finally {
      i18n.dispose()
    }
  })

  it('covers all literal panel, stage, and preview motion and pivot keys', () => {
    const consumers = [
      '../../../../../packages/stage-ui/src/features/motions/vrm/motion-library.vue',
      '../../../../../packages/stage-ui/src/components/scenes/Stage.vue',
      '../../../../../packages/stage-ui/src/components/scenarios/settings/model-settings/preview-stage.vue',
    ]
    for (const consumer of consumers) {
      const source = readFileSync(new URL(consumer, import.meta.url), 'utf8')
      const keys = [...source.matchAll(/['"](settings\.vrm\.(?:motions|orbit-pivot)\.[a-z.-]+)['"]/g)].map(match => match[1])
      expect(keys.length, consumer).toBeGreaterThan(0)
      for (const key of keys)
        expect(Object.hasOwn(expectedMessages, key), key).toBe(true)
    }
  })
})
