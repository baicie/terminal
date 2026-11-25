/**
 * Every headline this table can select must exist in every locale.
 *
 * ## The defect this exists for
 *
 * The six keys were added to the table and to no locale module, so i18next rendered
 * `terminal.hostKeyUnreachable` as the overlay title for every classified preflight
 * failure. Three suites were green over it:
 *
 *   - `locales/parity.test.ts` compares cn/fr *to en*, and all three were identically
 *     missing the keys;
 *   - `locales/translation-keys.test.ts` scans static `t('literal')` calls, and this
 *     table selects by value at runtime;
 *   - `e2e-07` asserted the title was not the old host-key sentence, which a raw key is.
 *
 * So this enumerates the table — the one thing none of them did.
 */

import { describe, expect, it } from 'vitest'
import cn from '@/locales/cn'
import en from '@/locales/en'
import fr from '@/locales/fr'
import { SSH_HOST_KEY_FAILURE_KEYS } from './ssh-host-key-failure-keys'

/*
 * The locale modules are **flat**: `'terminal.hostKeyUnreachable'` is one property
 * name, not `terminal -> hostKeyUnreachable`. Splitting on dots was the first version
 * of this helper, and it reported all six keys missing against a locale that had them.
 */
function resolve(bundle: unknown, key: string): unknown {
  return bundle !== null && typeof bundle === 'object'
    ? (bundle as Record<string, unknown>)[key]
    : undefined
}

describe('SSH host-key failure headlines', () => {
  const entries = Object.entries(SSH_HOST_KEY_FAILURE_KEYS)

  it('covers every classified failure step', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  for (const [name, locale] of [
    ['en', en],
    ['cn', cn],
    ['fr', fr],
  ] as const) {
    it(`${name} defines a sentence for every step`, () => {
      const missing = entries
        .filter(([, key]) => {
          const value = resolve(locale, key)
          return typeof value !== 'string' || value.length === 0
        })
        .map(([step, key]) => `${step} -> ${key}`)
      expect(missing, `${name} is missing headlines`).toEqual([])
    })
  }

  it('no headline is left as its own key', () => {
    for (const [name, locale] of [
      ['en', en],
      ['cn', cn],
      ['fr', fr],
    ] as const) {
      for (const [step, key] of entries) {
        const value = resolve(locale, key)
        expect(value, `${name}/${step}`).not.toBe(key)
      }
    }
  })
})
