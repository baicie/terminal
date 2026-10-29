import { describe, expect, it } from 'vitest'
import { getTabDisplayLabel, normalizeTerminalTitle } from './terminal-title'

describe('terminal title helpers', () => {
  it('normalizes shell whitespace and ignores empty titles', () => {
    expect(normalizeTerminalTitle('  user@host:\n /srv/app  ')).toBe(
      'user@host: /srv/app',
    )
    expect(normalizeTerminalTitle(' \t ')).toBeUndefined()
  })

  it('limits titles and falls back to the persistent tab label', () => {
    expect(normalizeTerminalTitle('x'.repeat(200))).toHaveLength(160)
    expect(getTabDisplayLabel({ label: 'Production' })).toBe('Production')
    expect(getTabDisplayLabel({ label: 'Production', title: 'deploy@prod' })).toBe(
      'deploy@prod',
    )
  })
})
