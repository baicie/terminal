/**
 * Tests for use-command-completion.ts
 *
 * Covers pure utility functions: word extraction, classification,
 * history/subcommand matching, path splitting, navigation, and merging.
 * (Path completion via Tauri invoke is tested via integration tests.)
 */

import { describe, expect, it } from 'vitest'
import {
  extractCurrentWord,
  getWordStart,
  classifyWord,
  findHistoryMatches,
  findSubcommandMatches,
  mergeCompletionItems,
  getNextCompletionIndex,
  getCompletionTypeLabel,
  type CompletionItem,
} from './use-command-completion'

// ---------------------------------------------------------------------------
// extractCurrentWord
// ---------------------------------------------------------------------------

describe('extractCurrentWord', () => {
  it('returns empty string at start of empty line', () => {
    expect(extractCurrentWord('', 0)).toBe('')
  })

  it('returns word at very beginning', () => {
    expect(extractCurrentWord('git status', 0)).toBe('')
  })

  it('returns partial word mid-entry', () => {
    expect(extractCurrentWord('git commi', 9)).toBe('commi')
  })

  it('handles tab as word boundary', () => {
    expect(extractCurrentWord('git\tcommit', 10)).toBe('commit')
  })

  it('returns word when cursor is at space', () => {
    // cursor at pos 3 = space. scan back finds 'g' at 0 → stop. slice(0,3)='git'
    expect(extractCurrentWord('git status', 3)).toBe('git')
  })

  it('returns the word before cursor (exclusive slice)', () => {
    // 'git commit -m "fix bug"' = 22 chars (0-21)
    // Pos 19 = 'b'. scan back: pos 18=space → stop. slice(19,19)=''
    expect(extractCurrentWord('git commit -m "fix bug"', 19)).toBe('')
  })

  it('returns the word when cursor is on its last character', () => {
    // Pos 18 = 'x'. scan back: pos 17='i'≠space, 16='f'≠space,
    //   15='"'≠space, 14=' '=space → stop. slice(15,18)='"fix'
    expect(extractCurrentWord('git commit -m "fix bug"', 18)).toBe('"fix')
  })

  it('handles line with only spaces', () => {
    expect(extractCurrentWord('    ', 2)).toBe('')
  })

  it('handles cursor past end of string', () => {
    expect(extractCurrentWord('abc', 10)).toBe('abc')
  })
})

// ---------------------------------------------------------------------------
// getWordStart
// ---------------------------------------------------------------------------

describe('getWordStart', () => {
  it('returns 0 at start of line', () => {
    expect(getWordStart('git status', 0)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(getWordStart('', 0)).toBe(0)
  })

  it('finds start of word when cursor is in the middle of a word', () => {
    // cursor at pos 4 = 's'. input[3]=' '=space → loop stops immediately. return 4
    expect(getWordStart('git status', 4)).toBe(4)
  })

  it('finds start of second word', () => {
    // cursor at pos 11 is after "status". scan back finds space at 3 → return 4
    expect(getWordStart('git status', 11)).toBe(4)
  })

  it('handles tab as delimiter', () => {
    expect(getWordStart('git\tcommit', 10)).toBe(4)
  })

  it('finds start of first word', () => {
    // cursor at space pos 3. scan back: input[2]='t'≠space → continue
    // input[1]='i'≠space → continue. input[0]='g'≠space → continue
    // start=0. loop ends. return 0
    expect(getWordStart('git status', 3)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// classifyWord
// ---------------------------------------------------------------------------

describe('classifyWord', () => {
  describe('returns "path" for path-like prefixes', () => {
    it('absolute path starting with /', () => {
      expect(classifyWord('/home/user')).toBe('path')
    })

    it('relative path starting with ./', () => {
      expect(classifyWord('./src')).toBe('path')
    })

    it('relative path starting with ../', () => {
      expect(classifyWord('../lib')).toBe('path')
    })

    it('home path starting with ~/', () => {
      expect(classifyWord('~/Documents')).toBe('path')
    })

    it('tilde without slash is NOT a path', () => {
      expect(classifyWord('~')).toBe('history')
    })
  })

  describe('returns "subcommand" for known shell commands', () => {
    it('git', () => {
      expect(classifyWord('git')).toBe('subcommand')
    })

    it('docker', () => {
      expect(classifyWord('docker')).toBe('subcommand')
    })

    it('npm', () => {
      expect(classifyWord('npm')).toBe('subcommand')
    })

    it('kubectl', () => {
      expect(classifyWord('kubectl')).toBe('subcommand')
    })

    it('cargo', () => {
      expect(classifyWord('cargo')).toBe('subcommand')
    })

    it('systemctl', () => {
      expect(classifyWord('systemctl')).toBe('subcommand')
    })
  })

  describe('returns "history" for unknown words', () => {
    it('random string', () => {
      expect(classifyWord('xyz123')).toBe('history')
    })

    it('partial unknown command', () => {
      expect(classifyWord('gi')).toBe('history')
    })

    it('unknown command with prefix', () => {
      expect(classifyWord('hell')).toBe('history')
    })

    it('empty string', () => {
      expect(classifyWord('')).toBe('history')
    })
  })

  describe('words with spaces fall back to history', () => {
    it('git status (has space) is NOT a known subcommand', () => {
      expect(classifyWord('git status')).toBe('history')
    })
  })
})

// ---------------------------------------------------------------------------
// findHistoryMatches
// ---------------------------------------------------------------------------

describe('findHistoryMatches', () => {
  const history = [
    'git status',
    'git commit -m "fix bug"',
    'git push origin main',
    'docker ps',
    'docker run -it ubuntu bash',
    'ls -la',
    'npm install',
    'git pull',
    'kubectl get pods',
  ]

  it('returns empty array for empty prefix', () => {
    expect(findHistoryMatches(history, '')).toEqual([])
  })

  it('matches case-insensitively', () => {
    const matches = findHistoryMatches(history, 'GIT')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].text).toBe('git status')
  })

  it('returns up to 20 matches', () => {
    const longHistory = Array.from({ length: 30 }, (_, i) => `git cmd${i}`)
    const matches = findHistoryMatches(longHistory, 'git')
    expect(matches).toHaveLength(20)
  })

  it('sets type to "history" on all items', () => {
    const matches = findHistoryMatches(history, 'git')
    expect(matches.every(m => m.type === 'history')).toBe(true)
  })

  it('uses text as label by default', () => {
    const matches = findHistoryMatches(history, 'ls')
    expect(matches).toHaveLength(1)
    expect(matches[0].label).toBe('ls -la')
    expect(matches[0].text).toBe('ls -la')
  })

  it('truncates long labels to 60 chars with ...', () => {
    const longCmd = 'git commit -m "this is a very long commit message that exceeds sixty characters"'
    const matches = findHistoryMatches([longCmd], 'git')
    expect(matches).toHaveLength(1)
    // slice(0, 57) + '...' = 60 chars total
    expect(matches[0].label.length).toBe(60)
    expect(matches[0].label.endsWith('...')).toBe(true)
    expect(matches[0].label.startsWith('git commit')).toBe(true)
  })

  it('returns items sorted by history order (first match first)', () => {
    const matches = findHistoryMatches(history, 'docker')
    expect(matches).toHaveLength(2)
    expect(matches[0].text).toBe('docker ps')
    expect(matches[1].text).toBe('docker run -it ubuntu bash')
  })
})

// ---------------------------------------------------------------------------
// findSubcommandMatches
// ---------------------------------------------------------------------------

describe('findSubcommandMatches', () => {
  it('returns subcommands for git', () => {
    const matches = findSubcommandMatches('git')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.some(m => m.text === 'commit')).toBe(true)
    expect(matches.some(m => m.text === 'push')).toBe(true)
  })

  it('returns subcommands for docker', () => {
    const matches = findSubcommandMatches('docker')
    expect(matches.some(m => m.text === 'run')).toBe(true)
    expect(matches.some(m => m.text === 'ps')).toBe(true)
  })

  it('returns subcommands for kubectl', () => {
    const matches = findSubcommandMatches('kubectl')
    expect(matches.some(m => m.text === 'get')).toBe(true)
    expect(matches.some(m => m.text === 'apply')).toBe(true)
  })

  it('returns subcommands for systemctl', () => {
    const matches = findSubcommandMatches('systemctl')
    expect(matches.some(m => m.text === 'start')).toBe(true)
    expect(matches.some(m => m.text === 'stop')).toBe(true)
    expect(matches.some(m => m.text === 'restart')).toBe(true)
  })

  it('returns subcommands for cargo', () => {
    const matches = findSubcommandMatches('cargo')
    expect(matches.some(m => m.text === 'build')).toBe(true)
    expect(matches.some(m => m.text === 'test')).toBe(true)
  })

  it('returns empty array for unknown command', () => {
    expect(findSubcommandMatches('unknowncmd')).toEqual([])
  })

  it('sets type to "subcommand" on all items', () => {
    const matches = findSubcommandMatches('git')
    expect(matches.every(m => m.type === 'subcommand')).toBe(true)
  })

  it('returns label equal to text', () => {
    const matches = findSubcommandMatches('git')
    matches.forEach(m => {
      expect(m.label).toBe(m.text)
    })
  })
})

// ---------------------------------------------------------------------------
// mergeCompletionItems
// ---------------------------------------------------------------------------

describe('mergeCompletionItems', () => {
  const histItem: CompletionItem = { text: 'git push', label: 'git push', type: 'history' }
  const otherHistItem: CompletionItem = { text: 'docker run', label: 'docker run', type: 'history' }

  it('merges items from multiple sources', () => {
    const result = mergeCompletionItems([histItem], [otherHistItem])
    expect(result).toHaveLength(2)
  })

  it('deduplicates exact duplicates (same type and same text)', () => {
    const dupItem: CompletionItem = { text: 'git push', label: 'git push', type: 'history' }
    const result = mergeCompletionItems([histItem], [dupItem])
    expect(result).toHaveLength(1) // exact duplicate
  })

  it('keeps items with same text but different type', () => {
    // Key is `${type}:${text.toLowerCase()}`, so different types = different keys
    const subItem: CompletionItem = { text: 'git push', label: 'push', type: 'subcommand' }
    const result = mergeCompletionItems([histItem], [subItem])
    expect(result).toHaveLength(2)
  })

  it('deduplicates case-insensitively for same type', () => {
    const lower = { text: 'git status', label: 'git status', type: 'history' as const }
    const upper = { text: 'Git Status', label: 'Git Status', type: 'history' as const }
    const result = mergeCompletionItems([lower], [upper])
    expect(result).toHaveLength(1)
  })

  it('keeps different cases when types differ', () => {
    const lower = { text: 'git status', label: 'git status', type: 'history' as const }
    const upper = { text: 'Git Status', label: 'Git Status', type: 'subcommand' as const }
    const result = mergeCompletionItems([lower], [upper])
    expect(result).toHaveLength(2)
  })

  it('returns empty when all sources empty', () => {
    expect(mergeCompletionItems([], [], [])).toEqual([])
  })

  it('returns items from single source', () => {
    const result = mergeCompletionItems([histItem, otherHistItem])
    expect(result).toHaveLength(2)
  })

  it('maintains order: first source items before second', () => {
    const a: CompletionItem = { text: 'a', label: 'a', type: 'history' }
    const b: CompletionItem = { text: 'b', label: 'b', type: 'history' }
    const c: CompletionItem = { text: 'c', label: 'c', type: 'history' }
    const result = mergeCompletionItems([a], [b, c])
    expect(result.map(r => r.text)).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// getNextCompletionIndex
// ---------------------------------------------------------------------------

describe('getNextCompletionIndex', () => {
  it('returns 0 when total is 0', () => {
    expect(getNextCompletionIndex(0, 0, false)).toBe(0)
  })

  it('wraps forward from last to first', () => {
    expect(getNextCompletionIndex(4, 5, false)).toBe(0)
  })

  it('wraps backward from first to last', () => {
    expect(getNextCompletionIndex(0, 5, true)).toBe(4)
  })

  it('moves forward normally', () => {
    expect(getNextCompletionIndex(1, 5, false)).toBe(2)
  })

  it('moves backward normally', () => {
    expect(getNextCompletionIndex(3, 5, true)).toBe(2)
  })

  it('handles single item (stays at 0)', () => {
    expect(getNextCompletionIndex(0, 1, false)).toBe(0)
    expect(getNextCompletionIndex(0, 1, true)).toBe(0)
  })

  it('handles two items alternating', () => {
    expect(getNextCompletionIndex(0, 2, false)).toBe(1)
    expect(getNextCompletionIndex(1, 2, false)).toBe(0)
    expect(getNextCompletionIndex(0, 2, true)).toBe(1)
    expect(getNextCompletionIndex(1, 2, true)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getCompletionTypeLabel
// ---------------------------------------------------------------------------

describe('getCompletionTypeLabel', () => {
  it('returns "history" for history type', () => {
    expect(getCompletionTypeLabel('history')).toBe('history')
  })

  it('returns "subcmd" for subcommand type', () => {
    expect(getCompletionTypeLabel('subcommand')).toBe('subcmd')
  })

  it('returns "path" for path type', () => {
    expect(getCompletionTypeLabel('path')).toBe('path')
  })

  it('returns "snippet" for snippet type', () => {
    expect(getCompletionTypeLabel('snippet')).toBe('snippet')
  })
})
