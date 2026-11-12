// UX-1a review — every path an old `sidebarVisible: true` can reach the store.
//
// There are three, and fixing only one is how the double-navigation regression
// survives:
//
//   1. the SQLite `workspace_layouts` row       (covered in workspace-layout-version.test.ts)
//   2. the localStorage recovery journal        (covered here)
//   3. the sanitizer that writes both of them   (covered here)
//
// (2) matters most in practice: the journal is written on every layout change and
// survives the upgrade, so the launch right after upgrading reads it before the
// database row is ever touched.

import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceLayout } from '@/types'
import { useAppStore } from '@/store/app'
import { LAYOUT_SCHEMA_VERSION } from './workspace-layout-version'
import {
  getWorkspaceRecoveryJournalKey,
  readRecoveryJournal,
  writeRecoveryJournal,
} from './workspace-recovery-journal'
import {
  readRecoveryLayout,
  sanitizeWorkspaceRecoveryLayout,
} from './workspace-recovery-layout'

function layout(overrides: Record<string, unknown> = {}): WorkspaceLayout {
  return {
    workspaceId: 'ws-1',
    tabs: [
      { id: 'tab-a', label: 'A', type: 'local' },
      { id: 'tab-b', label: 'B', type: 'remote', hostId: 'h-1' },
    ],
    splitGroups: [
      { id: 'split-1', mode: 'horizontal', tabs: ['tab-a', 'tab-b'], sizes: [60, 40] },
    ],
    activeTabId: 'tab-b',
    sidebarVisible: true,
    ...overrides,
  } as WorkspaceLayout
}

function storeJournal(value: unknown): void {
  localStorage.setItem(
    getWorkspaceRecoveryJournalKey('ws-1'),
    JSON.stringify(value),
  )
}

describe('recovery journal written before the upgrade', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: false,
    })
  })

  it('folds the sidebar when the journal predates versioning', () => {
    // A journal is `{version, savedAt, layout}`; the *journal* version is its own
    // field and has always been 1. What matters here is the layout inside it,
    // which an older build wrote without a `layoutVersion`.
    storeJournal({
      version: 1,
      savedAt: 1,
      layout: layout({ sidebarVisible: true }),
    })

    const snapshot = readRecoveryJournal('ws-1', sanitizeWorkspaceRecoveryLayout)

    expect(snapshot?.layout.sidebarVisible).toBe(false)
    expect(snapshot?.layout.layoutVersion).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('keeps the tab ids, split group and active tab from the journal', () => {
    // The migration must not cost the user their terminals. This is the assertion
    // that makes "fold the sidebar" safe to do at all.
    storeJournal({ version: 1, savedAt: 1, layout: layout() })

    const snapshot = readRecoveryJournal('ws-1', sanitizeWorkspaceRecoveryLayout)

    expect(snapshot?.layout.tabs.map(tab => tab.id)).toEqual(['tab-a', 'tab-b'])
    expect(snapshot?.layout.splitGroups).toEqual([
      { id: 'split-1', mode: 'horizontal', tabs: ['tab-a', 'tab-b'], sizes: [60, 40] },
    ])
    expect(snapshot?.layout.activeTabId).toBe('tab-b')
  })

  it('honors a sidebar the new build chose to open', () => {
    // Rewriting the journal on read is fine; changing the value the new build
    // stored is not, or the sidebar would collapse on every launch.
    storeJournal({
      version: 1,
      savedAt: 1,
      layout: layout({
        sidebarVisible: true,
        layoutVersion: LAYOUT_SCHEMA_VERSION,
      }),
    })

    const snapshot = readRecoveryJournal('ws-1', sanitizeWorkspaceRecoveryLayout)

    expect(snapshot?.layout.sidebarVisible).toBe(true)
  })

  it('rewrites the journal so the fold happens exactly once', () => {
    storeJournal({ version: 1, savedAt: 1, layout: layout({ sidebarVisible: true }) })

    readRecoveryJournal('ws-1', sanitizeWorkspaceRecoveryLayout)

    const raw = localStorage.getItem(getWorkspaceRecoveryJournalKey('ws-1'))
    const rewritten = JSON.parse(raw as string)
    expect(rewritten.layout.sidebarVisible).toBe(false)
    expect(rewritten.layout.layoutVersion).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('still discards an unreadable journal', () => {
    localStorage.setItem(getWorkspaceRecoveryJournalKey('ws-1'), '{{{')

    expect(readRecoveryJournal('ws-1', sanitizeWorkspaceRecoveryLayout)).toBeNull()
    expect(localStorage.getItem(getWorkspaceRecoveryJournalKey('ws-1'))).toBeNull()
  })

  it('still refuses an unknown journal schema version', () => {
    storeJournal({ version: 99, savedAt: 1, layout: layout() })

    expect(readRecoveryJournal('ws-1', sanitizeWorkspaceRecoveryLayout)).toBeNull()
  })
})

describe('the sanitizer must not reintroduce the old default', () => {
  const base = {
    workspaceId: 'ws-1',
    tabs: [{ id: 'tab-a', label: 'A', type: 'local' as const }],
    splitGroups: [],
    activeTabId: 'tab-a',
  }

  it('stamps the current version and folds a legacy layout', () => {
    // This used to be `typeof x === 'boolean' ? x : true` — it took the raw
    // boolean and defaulted to open, so it re-created the pre-upgrade value on
    // the way to disk even after the read side had folded it.
    const sanitized = sanitizeWorkspaceRecoveryLayout({
      ...base,
      sidebarVisible: true,
    } as WorkspaceLayout)

    expect(sanitized.sidebarVisible).toBe(false)
    expect(sanitized.layoutVersion).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('keeps an open sidebar at the current version', () => {
    const sanitized = sanitizeWorkspaceRecoveryLayout({
      ...base,
      sidebarVisible: true,
      layoutVersion: LAYOUT_SCHEMA_VERSION,
    })

    expect(sanitized.sidebarVisible).toBe(true)
  })

  it('defaults a missing boolean to closed, not open', () => {
    const sanitized = sanitizeWorkspaceRecoveryLayout({
      ...base,
    } as unknown as WorkspaceLayout)

    expect(sanitized.sidebarVisible).toBe(false)
  })
})

describe('the live layout snapshot', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState({
      tabs: [],
      splitGroups: [],
      activeTabId: null,
      sidebarVisible: false,
    })
  })

  it('does not fold a sidebar the user just opened', () => {
    // The regression this guards: if the in-memory snapshot were stamped legacy,
    // every journal write would close a sidebar the user had opened by hand and
    // the next launch would start folded — for a preference the user set.
    useAppStore.setState({ sidebarVisible: true })

    const snapshot = readRecoveryLayout('ws-1')

    expect(snapshot.sidebarVisible).toBe(true)
    expect(snapshot.layoutVersion).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('round-trips an open preference through the journal', () => {
    useAppStore.setState({
      tabs: [{ id: 'tab-a', label: 'A', type: 'local' }],
      activeTabId: 'tab-a',
      sidebarVisible: true,
    })

    const written = readRecoveryLayout('ws-1')
    const snapshot = readRecoveryJournal('ws-1', sanitizeWorkspaceRecoveryLayout)
    writeRecoveryJournal({
      workspaceId: 'ws-1',
      layout: written,
      journalValue: JSON.stringify({ version: 1, savedAt: Date.now(), layout: written }),
    })
    const reread = readRecoveryJournal('ws-1', sanitizeWorkspaceRecoveryLayout)

    expect(snapshot).toBeNull() // nothing written yet
    expect(reread?.layout.sidebarVisible).toBe(true)
  })
})
