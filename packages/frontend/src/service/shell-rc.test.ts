/**
 * Tests for shell-rc.ts — shell RC parsing for command completion
 *
 * Tests the pure exported functions by importing directly from the source.
 * Remote parsing via Tauri/session_exec is integration-test territory.
 */

import { describe, expect, it } from 'vitest'
import {
  toCompletionItems,
  matchRCItems,
  type ParsedShellRC,
} from './shell-rc'

// ---------------------------------------------------------------------------
// Tests: toCompletionItems
// ---------------------------------------------------------------------------

describe('toCompletionItems', () => {
  it('converts aliases to completion items', () => {
    const parsed: ParsedShellRC = {
      aliases: [
        { name: 'll', value: 'ls -la', shell: 'bash' },
        { name: 'gs', value: 'git status', shell: 'bash' },
      ],
      functions: [],
      shell: 'bash',
    }
    const items = toCompletionItems(parsed)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ name: 'll', type: 'alias', detail: 'ls -la' })
    expect(items[1]).toMatchObject({ name: 'gs', type: 'alias' })
  })

  it('converts functions to completion items', () => {
    const parsed: ParsedShellRC = {
      aliases: [],
      functions: [
        { name: 'deploy', body: 'echo deploying to production', shell: 'bash' },
      ],
      shell: 'bash',
    }
    const items = toCompletionItems(parsed)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'deploy', type: 'function' })
  })

  it('converts both aliases and functions', () => {
    const parsed: ParsedShellRC = {
      aliases: [{ name: 'll', value: 'ls -la', shell: 'bash' }],
      functions: [{ name: 'greet', body: 'echo hi', shell: 'bash' }],
      shell: 'bash',
    }
    const items = toCompletionItems(parsed)
    expect(items).toHaveLength(2)
  })

  it('truncates long alias values to 40 chars with ellipsis', () => {
    const parsed: ParsedShellRC = {
      aliases: [{ name: 'll', value: 'a'.repeat(60), shell: 'bash' }],
      functions: [],
      shell: 'bash',
    }
    const items = toCompletionItems(parsed)
    expect(items[0].detail.length).toBe(40)
    expect(items[0].detail.endsWith('...')).toBe(true)
  })

  it('truncates long function bodies to 40 chars with ellipsis', () => {
    const parsed: ParsedShellRC = {
      aliases: [],
      functions: [{ name: 'func', body: 'b'.repeat(60), shell: 'bash' }],
      shell: 'bash',
    }
    const items = toCompletionItems(parsed)
    expect(items[0].detail.length).toBe(40)
    expect(items[0].detail.endsWith('...')).toBe(true)
  })

  it('returns empty array for empty parsed content', () => {
    const parsed: ParsedShellRC = { aliases: [], functions: [], shell: 'bash' }
    expect(toCompletionItems(parsed)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: matchRCItems
// ---------------------------------------------------------------------------

describe('matchRCItems', () => {
  const items = [
    { name: 'll', label: 'll', type: 'alias' as const, detail: 'ls -la' },
    { name: 'gs', label: 'gs', type: 'alias' as const, detail: 'git status' },
    { name: 'greet', label: 'greet', type: 'function' as const, detail: 'echo hi' },
  ]

  it('returns all items when prefix is empty', () => {
    // Every string starts with empty string, so all match when prefix is ''
    expect(matchRCItems(items, '')).toHaveLength(3)
  })

  it('filters by prefix (case-insensitive)', () => {
    const matches = matchRCItems(items, 'g')
    expect(matches).toHaveLength(2)
    expect(matches.map(m => m.name)).toContain('gs')
    expect(matches.map(m => m.name)).toContain('greet')
  })

  it('limits to 20 results', () => {
    const longList = Array.from({ length: 30 }, (_, i) => ({
      name: `alias${i}`, label: `alias${i}`, type: 'alias' as const, detail: '',
    }))
    expect(matchRCItems(longList, 'a')).toHaveLength(20)
  })

  it('returns empty array when nothing matches', () => {
    const matches = matchRCItems(items, 'xyz')
    expect(matches).toHaveLength(0)
  })

  it('matches exact name', () => {
    const matches = matchRCItems(items, 'll')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('ll')
  })
})
