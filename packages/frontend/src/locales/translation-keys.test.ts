import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import cn from './cn'
import en from './en'
import fr from './fr'

const translations: Record<string, Record<string, string>> = { cn, en, fr }
const sourceRoot = path.resolve(process.cwd(), 'src')

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(target)
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')
      ? [target]
      : []
  })
}

function hasTranslation(locale: Record<string, string>, key: string) {
  return (
    key in locale ||
    (`${key}_one` in locale && `${key}_other` in locale)
  )
}

describe('translation keys', () => {
  it.each(Object.entries(translations))(
    '%s exposes the same keys as every other locale',
    (_language, locale) => {
      const allKeys = new Set(
        Object.values(translations).flatMap(values => Object.keys(values)),
      )
      const missingKeys = [...allKeys].filter(key => !(key in locale)).sort()

      expect(missingKeys).toEqual([])
    },
  )

  it.each(Object.entries(translations))(
    '%s defines every statically referenced translation key',
    (_language, locale) => {
      const missingKeys = new Set<string>()
      const translationCall =
        /\b(?:t|tr)\(\s*['"]([A-Za-z][A-Za-z0-9_.-]+)['"]/g

      for (const file of collectSourceFiles(sourceRoot)) {
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(translationCall)) {
          const key = match[1]
          if (key.includes('.') && !hasTranslation(locale, key)) {
            missingKeys.add(key)
          }
        }
      }

      expect([...missingKeys].sort()).toEqual([])
    },
  )

  it('does not request namespaces that are absent from i18next resources', () => {
    const unsupportedNamespaces: string[] = []
    const namespacedHook = /useTranslation\(\s*['"]([^'"]+)['"]\s*\)/g

    for (const file of collectSourceFiles(sourceRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(namespacedHook)) {
        if (match[1] !== 'translation') {
          unsupportedNamespaces.push(
            `${path.relative(sourceRoot, file)}: ${match[1]}`,
          )
        }
      }
    }

    expect(unsupportedNamespaces.sort()).toEqual([])
  })
})
