/**
 * Tests for the fuzzy search utilities used in the command palette.
 * These pure functions rank and filter command-palette results.
 */

import { describe, expect, it } from 'vitest'
import { fuzzyMatch, fuzzyScore } from './command-palette-utils'

// ─── Tests ────────────────────────────────────────────────────────────────

describe('fuzzyScore', () => {
  it('returns 1 for empty pattern on any text', () => {
    expect(fuzzyScore('', 'hello')).toBe(1)
    expect(fuzzyScore('', '')).toBe(1)
  })

  it('gives highest score for exact prefix match', () => {
    expect(fuzzyScore('hel', 'hello')).toBeGreaterThan(
      fuzzyScore('el', 'hello'),
    )
  })

  it('prefix match scores higher than non-prefix substring match', () => {
    // "hel" is a prefix of "hello", "ell" is a substring but not prefix
    expect(fuzzyScore('hel', 'hello')).toBeGreaterThan(
      fuzzyScore('ell', 'hello'),
    )
  })

  it('returns 0 when pattern chars are not all found', () => {
    expect(fuzzyScore('xyz', 'hello')).toBe(0)
    expect(fuzzyScore('leh', 'hello')).toBe(0) // out of order
  })

  it('returns 0 for case-mismatched consecutive chars', () => {
    // Lower pattern "he" is found in "HeLLo" (case-insensitive)
    expect(fuzzyScore('he', 'HeLLo')).toBeGreaterThan(0)
  })

  it('rewards consecutive matching chars with higher score', () => {
    const scoreBroken = fuzzyScore('hl', 'hello') // h, l not consecutive
    const scoreStart = fuzzyScore('he', 'hello') // h, e consecutive
    expect(scoreStart).toBeGreaterThan(scoreBroken)
  })
})

describe('fuzzyMatch', () => {
  it('returns true for empty pattern', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true)
  })

  it('returns true for exact substring', () => {
    expect(fuzzyMatch('ell', 'hello')).toBe(true)
  })

  it('returns true for prefix match', () => {
    expect(fuzzyMatch('hel', 'hello')).toBe(true)
  })

  it('returns true for consecutive character match', () => {
    expect(fuzzyMatch('he', 'hello')).toBe(true)
  })

  it('returns false for non-matching pattern', () => {
    expect(fuzzyMatch('xyz', 'hello')).toBe(false)
  })

  it('returns false when pattern chars out of order', () => {
    expect(fuzzyMatch('leh', 'hello')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('HELLO', 'hello')).toBe(true)
    expect(fuzzyMatch('hello', 'HELLO')).toBe(true)
  })
})

describe('fuzzy search — real-world command palette scenarios', () => {
  const hosts = [
    {
      name: 'Production Web',
      hostname: 'web.prod.example.com',
      username: 'admin',
    },
    {
      name: 'Staging API',
      hostname: 'api.staging.example.com',
      username: 'deploy',
    },
    {
      name: 'Dev Database',
      hostname: 'db.dev.example.com',
      username: 'devops',
    },
    {
      name: 'Jump Server',
      hostname: 'bastion.example.com',
      username: 'jumper',
    },
  ]

  function searchHosts(pattern: string) {
    return hosts
      .filter(host => {
        const haystack =
          `${host.name} ${host.hostname} ${host.username}`.toLowerCase()
        return fuzzyMatch(pattern, haystack)
      })
      .map(h => h.name)
  }

  it('finds host by name prefix', () => {
    expect(searchHosts('pro')).toContain('Production Web')
    expect(searchHosts('prod')).toContain('Production Web')
  })

  it('finds host by partial name', () => {
    expect(searchHosts('web')).toContain('Production Web')
  })

  it('finds host by hostname', () => {
    expect(searchHosts('bastion')).toContain('Jump Server')
    expect(searchHosts('staging')).toContain('Staging API')
  })

  it('finds host by username', () => {
    expect(searchHosts('admin')).toContain('Production Web')
    expect(searchHosts('deploy')).toContain('Staging API')
  })

  it('finds host by fuzzy character matching', () => {
    // "pwb" should match "Production Web" via fuzzy chars
    expect(searchHosts('pwb')).toContain('Production Web')
  })

  it('returns empty for no match', () => {
    expect(searchHosts('xyz123')).toHaveLength(0)
  })

  it('finds all matching hosts', () => {
    const results = searchHosts('example')
    expect(results).toContain('Production Web')
    expect(results).toContain('Staging API')
    expect(results).toContain('Dev Database')
    expect(results).toContain('Jump Server')
  })
})
