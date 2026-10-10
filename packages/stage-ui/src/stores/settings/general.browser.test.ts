import messages from '@proj-airi/i18n/locales'

import { resolveSupportedLocale } from '@proj-airi/i18n'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'

import { useSettingsGeneral } from './general'

const cleanups: Array<() => void> = []
let settingsStore: ReturnType<typeof useSettingsGeneral>

describe('store settings-general', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const previousLanguage = localStorage.getItem('settings/language')
    localStorage.removeItem('settings/language')
    const app = createApp({
      setup() {
        settingsStore = useSettingsGeneral()
        return () => null
      },
    })
    app.use(pinia)
    const container = document.createElement('div')
    document.body.append(container)
    app.mount(container)
    cleanups.push(() => {
      app.unmount()
      container.remove()
      disposePinia(pinia)
      if (previousLanguage === null)
        localStorage.removeItem('settings/language')
      else
        localStorage.setItem('settings/language', previousLanguage)
    })
  })

  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse())
      cleanup()
  })

  // https://github.com/moeru-ai/airi/issues/1658
  // An Electron restart can lose the persisted locale. Missing storage must fall back to the browser locale.
  it('issue #1658: falls back to navigator.language when localStorage is empty', () => {
    localStorage.removeItem('settings/language')
    expect(settingsStore.getLanguage()).toBe(resolveSupportedLocale(navigator.language || 'en', Object.keys(messages)))
  })

  it('issue #1658: returns persisted language when localStorage has a value', () => {
    localStorage.setItem('settings/language', 'zh-Hant')
    expect(settingsStore.getLanguage()).toBe('zh-Hant')
  })
})
