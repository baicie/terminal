import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import cn from './cn'
import en from './en'
import fr from './fr'

const translations: Record<string, Record<string, string>> = { cn, en, fr }
const singleBraceInterpolation = /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*\}(?!\})/

describe('locale interpolation', () => {
  it.each(Object.entries(translations))(
    '%s uses i18next double-brace placeholders',
    (_language, locale) => {
      const malformedKeys = Object.entries(locale)
        .filter(([, value]) => singleBraceInterpolation.test(value))
        .map(([key]) => key)

      expect(malformedKeys).toEqual([])
    },
  )

  it.each(Object.entries(translations))(
    '%s renders host counts without leaking interpolation syntax',
    async (language, locale) => {
      const i18n = createInstance()
      await i18n.init({
        lng: language,
        resources: { [language]: { translation: locale } },
      })

      expect(i18n.t('hosts.count', { count: 2 })).not.toMatch(/[{}]/)
    },
  )
})
