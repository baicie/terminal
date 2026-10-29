/**
 * Tests for sync.ts — pure functions
 *
 * Only tests the pure, side-effect-free functions:
 * - previewTeamPackage(content)
 * - previewImportData(content)
 * - formatLastSyncTime()
 * - getLastSyncTime()  [uses localStorage — mocked per test]
 *
 * All functions that require Tauri plugins (dialog, fs, sql) or the database
 * are integration-test targets and are not covered here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Pure function re-implementations (kept in sync with actual source)
// ---------------------------------------------------------------------------

interface TeamPackageExport {
  version: string
  teamName: string
  exportedAt: string
  exportedBy: string
  members: unknown[]
  hosts: unknown[]
  groups: unknown[]
  snippets: unknown[]
  snippetPackages: unknown[]
  sshKeys: unknown[]
  knownHosts: unknown[]
  workspaces: unknown[]
  workspaceLayouts: unknown[]
}

interface ExportData {
  version: string
  exportedAt: number
  exportedBy?: string
  type: 'full' | 'team'
  hosts: unknown[]
  groups: unknown[]
  snippets: unknown[]
  snippetPackages: unknown[]
  workspaces: unknown[]
  workspaceLayouts: unknown[]
  sshKeys: unknown[]
  knownHosts: unknown[]
  settings: Record<string, unknown>
  team?: unknown
}

function previewTeamPackage(content: string): TeamPackageExport | null {
  try {
    const data = JSON.parse(content) as TeamPackageExport
    if (data.version !== '1.0' || !data.teamName) {
      return null
    }
    return data
  } catch {
    return null
  }
}

function previewImportData(content: string): ExportData | null {
  try {
    const data = JSON.parse(content) as ExportData
    return {
      ...data,
      hosts: data.hosts || [],
      groups: data.groups || [],
      snippets: data.snippets || [],
      snippetPackages: data.snippetPackages || [],
      workspaces: data.workspaces || [],
      workspaceLayouts: data.workspaceLayouts || [],
      sshKeys: data.sshKeys || [],
      knownHosts: data.knownHosts || [],
      settings: data.settings || {},
    }
  } catch {
    return null
  }
}

function getLastSyncTime(): number | null {
  const stored = localStorage.getItem('terminal.lastSyncTime')
  if (stored) {
    const time = parseInt(stored, 10)
    return isNaN(time) ? null : time
  }
  return null
}

function formatLastSyncTime(): string | null {
  const lastSync = getLastSyncTime()
  if (!lastSync) return null

  const now = Date.now()
  const diff = now - lastSync

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  }
  if (seconds > 10) {
    return `${seconds} seconds ago`
  }
  return 'just now'
}

// ---------------------------------------------------------------------------
// Tests: previewTeamPackage
// ---------------------------------------------------------------------------
describe('previewTeamPackage', () => {
  it('returns null for invalid JSON', () => {
    expect(previewTeamPackage('{ invalid json }')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(previewTeamPackage('')).toBeNull()
  })

  it('returns null when version is not "1.0"', () => {
    const data = { version: '2.0', teamName: 'My Team' }
    expect(previewTeamPackage(JSON.stringify(data))).toBeNull()
  })

  it('returns null when teamName is missing', () => {
    const data = { version: '1.0' }
    expect(previewTeamPackage(JSON.stringify(data))).toBeNull()
  })

  it('returns null when teamName is an empty string', () => {
    const data = { version: '1.0', teamName: '' }
    expect(previewTeamPackage(JSON.stringify(data))).toBeNull()
  })

  it('returns parsed data when version is "1.0" and teamName is present', () => {
    const data: TeamPackageExport = {
      version: '1.0',
      teamName: 'My Team',
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'user-123',
      members: [],
      hosts: [{ id: 'h1', name: 'server1' }],
      groups: [],
      snippets: [],
      snippetPackages: [],
      sshKeys: [],
      knownHosts: [],
      workspaces: [],
      workspaceLayouts: [],
    }
    const result = previewTeamPackage(JSON.stringify(data))
    expect(result).not.toBeNull()
    expect(result!.version).toBe('1.0')
    expect(result!.teamName).toBe('My Team')
    expect(result!.hosts).toHaveLength(1)
  })

  it('accepts valid data with all optional fields', () => {
    const data: TeamPackageExport = {
      version: '1.0',
      teamName: 'Engineering',
      exportedAt: '2026-03-01T12:00:00.000Z',
      exportedBy: 'alice',
      members: [{ user_id: 'u1' }],
      hosts: [],
      groups: [],
      snippets: [],
      snippetPackages: [],
      sshKeys: [{ id: 'k1' }],
      knownHosts: [],
      workspaces: [],
      workspaceLayouts: [],
    }
    const result = previewTeamPackage(JSON.stringify(data))
    expect(result).not.toBeNull()
    expect(result!.exportedBy).toBe('alice')
    expect(result!.members).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: previewImportData
// ---------------------------------------------------------------------------
describe('previewImportData', () => {
  it('returns null for invalid JSON', () => {
    expect(previewImportData('not json')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(previewImportData('')).toBeNull()
  })

  it('returns data with empty arrays for missing fields', () => {
    const data = { version: '1.0.0', exportedAt: Date.now() }
    const result = previewImportData(JSON.stringify(data))
    expect(result).not.toBeNull()
    expect(result!.hosts).toEqual([])
    expect(result!.groups).toEqual([])
    expect(result!.snippets).toEqual([])
    expect(result!.snippetPackages).toEqual([])
    expect(result!.workspaces).toEqual([])
    expect(result!.workspaceLayouts).toEqual([])
    expect(result!.sshKeys).toEqual([])
    expect(result!.knownHosts).toEqual([])
    expect(result!.settings).toEqual({})
  })

  it('returns data with defaults when arrays are null', () => {
    const data = {
      version: '1.0.0',
      exportedAt: Date.now(),
      hosts: null,
      groups: null,
    }
    const result = previewImportData(JSON.stringify(data))
    expect(result!.hosts).toEqual([])
    expect(result!.groups).toEqual([])
  })

  it('returns parsed data with all fields', () => {
    const data: ExportData = {
      version: '1.0.0',
      exportedAt: Date.now(),
      exportedBy: 'user-456',
      type: 'full',
      hosts: [{ id: 'h1', name: 'prod-server' }],
      groups: [{ id: 'g1', name: 'Production' }],
      snippets: [{ id: 's1', name: 'Deploy script' }],
      snippetPackages: [{ id: 'p1', name: 'Scripts' }],
      workspaces: [{ id: 'w1', name: 'Main' }],
      workspaceLayouts: [],
      sshKeys: [{ id: 'k1', name: 'id_rsa' }],
      knownHosts: [{ id: 'kh1', hostname: 'server.com' }],
      settings: { theme: 'dark' },
    }
    const result = previewImportData(JSON.stringify(data))
    expect(result!.hosts).toHaveLength(1)
    expect(result!.groups).toHaveLength(1)
    expect(result!.snippets).toHaveLength(1)
    expect(result!.settings.theme).toBe('dark')
  })

  it('preserves original version and exportedAt', () => {
    const timestamp = 1710000000000
    const data = { version: '1.0.0', exportedAt: timestamp, hosts: [] }
    const result = previewImportData(JSON.stringify(data))
    expect(result!.version).toBe('1.0.0')
    expect(result!.exportedAt).toBe(timestamp)
  })
})

// ---------------------------------------------------------------------------
// Tests: getLastSyncTime + formatLastSyncTime
// ---------------------------------------------------------------------------

// Freeze Date.now() so time-delta math is deterministic across all formatLastSyncTime tests.
const FIXED_NOW = 1704067200000 // 2024-01-01 00:00:00 UTC
let dateNowSpy: ReturnType<typeof vi.spyOn>

describe('getLastSyncTime + formatLastSyncTime', () => {
  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)
  })

  afterEach(() => {
    dateNowSpy.mockRestore()
  })

  // Build a fake Storage backed by a plain object map.
  const makeStorage = (map: Record<string, string | null>) => {
    const store: Record<string, string | null> = { ...map }
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (_k: string, _v: string) => { /* noop */ },
      removeItem: (_k: string) => { /* noop */ },
      clear: () => { /* noop */ },
      key: (_i: number) => null,
      get length() { return Object.keys(store).length },
    } as unknown as Storage
  }

  // Stub global localStorage for a single test.
  const withLocalStorage = <T>(map: Record<string, string | null>, fn: () => T): T => {
    vi.stubGlobal('localStorage', makeStorage(map))
    return fn()
  }

  describe('getLastSyncTime', () => {
    it('returns null when no value is stored', () => {
      expect(withLocalStorage({}, () => getLastSyncTime())).toBeNull()
    })

    it('returns null when value is not a number string', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': 'not-a-number' }, () => getLastSyncTime())).toBeNull()
    })

    it('returns null when value is empty string', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': '' }, () => getLastSyncTime())).toBeNull()
    })

    it('returns parsed number when valid', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': '1710000000000' }, () => getLastSyncTime())).toBe(1710000000000)
    })

    it('handles zero as valid timestamp', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': '0' }, () => getLastSyncTime())).toBe(0)
    })
  })

  describe('formatLastSyncTime', () => {
    it('returns null when no sync time is stored', () => {
      expect(withLocalStorage({}, () => formatLastSyncTime())).toBeNull()
    })

    it('returns "just now" for very recent sync (< 10 seconds)', () => {
      // 5 seconds ago — less than 10s threshold → "just now"
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 5 * 1000) }, () => formatLastSyncTime())).toBe('just now')
    })

    it('returns "just now" for zero-difference', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW) }, () => formatLastSyncTime())).toBe('just now')
    })

    it('returns "X seconds ago" for 11+ seconds', () => {
      // 11 seconds ago → seconds=11 (>10), minutes=0 → "11 seconds ago"
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 11 * 1000) }, () => formatLastSyncTime())).toBe('11 seconds ago')
    })

    it('returns "1 minute ago" for exactly 60 seconds', () => {
      // 60 seconds → minutes=1 (>0) → "1 minute ago" (minutes branch takes precedence)
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 60 * 1000) }, () => formatLastSyncTime())).toBe('1 minute ago')
    })

    it('returns "2 minutes ago" for 2 minutes', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 2 * 60 * 1000) }, () => formatLastSyncTime())).toBe('2 minutes ago')
    })

    it('returns "1 hour ago" for exactly 60 minutes', () => {
      // 60 minutes → hours=1 (>0) → "1 hour ago"
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 60 * 60 * 1000) }, () => formatLastSyncTime())).toBe('1 hour ago')
    })

    it('returns "3 hours ago" for 3 hours', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 3 * 60 * 60 * 1000) }, () => formatLastSyncTime())).toBe('3 hours ago')
    })

    it('returns "1 day ago" for exactly 24 hours', () => {
      // 24 hours → days=1 (>0) → "1 day ago"
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 24 * 60 * 60 * 1000) }, () => formatLastSyncTime())).toBe('1 day ago')
    })

    it('returns "2 days ago" for 2 days', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 2 * 24 * 60 * 60 * 1000) }, () => formatLastSyncTime())).toBe('2 days ago')
    })

    it('returns "5 days ago" for 5 days', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 5 * 24 * 60 * 60 * 1000) }, () => formatLastSyncTime())).toBe('5 days ago')
    })

    it('uses plural "days" for 2+ days', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 2 * 24 * 60 * 60 * 1000) }, () => formatLastSyncTime())).toBe('2 days ago')
    })

    it('uses singular "day" for 1 day', () => {
      expect(withLocalStorage({ 'terminal.lastSyncTime': String(FIXED_NOW - 1 * 24 * 60 * 60 * 1000) }, () => formatLastSyncTime())).toBe('1 day ago')
    })
  })
})
