/**
 * Tests for command-history database operations
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the database connection
vi.mock('./connection', () => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
}))

import { executeQuery, select } from './connection'
import {
  addCommandHistory,
  getCommandHistory,
  searchCommandHistory,
  clearCommandHistory,
} from './command-history'

const { executeQuery: eq, select: sel } = vi.mocked({ executeQuery, select })

describe('addCommandHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a command record with all fields', async () => {
    eq.mockResolvedValue({ rowsAffected: 1 } as never)

    await addCommandHistory({
      host_id: 'host-1',
      command: 'ls -la',
      executed_at: 1715000000000,
      session_id: 'sess-abc',
    })

    expect(eq).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO command_history'),
      ['host-1', 'ls -la', 1715000000000, 'sess-abc'],
    )
  })

  it('passes null when session_id is omitted', async () => {
    eq.mockResolvedValue({ rowsAffected: 1 } as never)

    await addCommandHistory({
      host_id: 'host-2',
      command: 'pwd',
      executed_at: 1715000001000,
    })

    expect(eq).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO command_history'),
      ['host-2', 'pwd', 1715000001000, null],
    )
  })
})

describe('getCommandHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all records when no hostId given', async () => {
    const rows = [
      { id: 1, host_id: 'h1', command: 'cd /', executed_at: 1000, session_id: null },
      { id: 2, host_id: 'h2', command: 'ls', executed_at: 2000, session_id: 's1' },
    ]
    sel.mockResolvedValue(rows as never)

    const result = await getCommandHistory()

    expect(sel).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY executed_at DESC LIMIT'),
      [100],
    )
    expect(result).toEqual(rows)
  })

  it('filters by hostId when provided', async () => {
    sel.mockResolvedValue([] as never)

    await getCommandHistory('host-x', 50)

    expect(sel).toHaveBeenCalledWith(
      expect.stringContaining('WHERE host_id ='),
      ['host-x', 50],
    )
  })

  it('respects the limit parameter', async () => {
    sel.mockResolvedValue([] as never)

    await getCommandHistory(undefined, 25)

    expect(sel).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT'),
      [25],
    )
  })
})

describe('searchCommandHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('escapes ReDoS-prone characters', async () => {
    sel.mockResolvedValue([] as never)

    await searchCommandHistory('test%_file')

    // % and _ must be escaped in LIKE clause
    expect(sel).toHaveBeenCalledWith(
      expect.stringContaining('ESCAPE'),
      expect.arrayContaining([expect.stringContaining('\\%')]),
    )
  })

  it('returns at most 100 results regardless of limit', async () => {
    sel.mockResolvedValue([] as never)

    await searchCommandHistory('find', 500)

    expect(sel).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([Math.min(500, 100)]),
    )
  })
})

describe('clearCommandHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes all history when no hostId given', async () => {
    eq.mockResolvedValue({ rowsAffected: 5 } as never)

    await clearCommandHistory()

    expect(eq).toHaveBeenCalledWith(
      'DELETE FROM command_history',
    )
  })

  it('deletes only specific host history when hostId given', async () => {
    eq.mockResolvedValue({ rowsAffected: 3 } as never)

    await clearCommandHistory('host-y')

    expect(eq).toHaveBeenCalledWith(
      expect.stringContaining('WHERE host_id'),
      ['host-y'],
    )
  })
})
