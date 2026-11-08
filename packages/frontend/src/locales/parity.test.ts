// Every locale must expose exactly the keys English defines.
//
// A missing key is not a cosmetic issue: i18next falls back to the key name, so
// a Chinese or French user sees `settings.saveFailed` instead of a sentence. The
// test compares the complete key set, not a sample, because the gaps that reach
// users are always the ones nobody sampled.

import { describe, expect, it } from 'vitest'
import cn from './cn'
import en from './en'
import fr from './fr'

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return [prefix]
  return entries.flatMap(([key, child]) =>
    flattenKeys(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

function flattenValues(
  value: unknown,
  prefix = '',
  out: Array<[string, unknown]> = [],
): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object') {
    out.push([prefix, value])
    return out
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flattenValues(child, prefix === '' ? key : `${prefix}.${key}`, out)
  }
  return out
}

describe('locale parity', () => {
  it('cn and fr define exactly the keys en defines', () => {
    const reference = flattenKeys(en).sort()
    expect(flattenKeys(cn).sort()).toEqual(reference)
    expect(flattenKeys(fr).sort()).toEqual(reference)
  })

  it('no locale leaves a visible string empty', () => {
    for (const [name, locale] of [['en', en], ['cn', cn], ['fr', fr]] as const) {
      const empty = flattenValues(locale)
        .filter(([, value]) => value === '')
        .map(([key]) => key)
      expect(empty, `${name} has empty strings`).toEqual([])
    }
  })
})
