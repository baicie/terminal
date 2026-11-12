// UX-1a review — upgrading must not reopen the sidebar next to the rail.
//
// UX-1a made the activity rail permanent navigation and turned the detailed
// sidebar into an optional panel, so a new install starts with the sidebar closed.
// But every layout an older build saved has `sidebarVisible: true` in it, because
// that was the default then. Restoring that faithfully produces the exact
// regression this phase is meant to remove: a 46px rail and a 220px sidebar both
// listing the same destinations, with a terminal 220px narrower than before the
// upgrade.
//
// The migration is versioned rather than "force it closed", because a user who
// opens the explorer by hand must get it back on the next launch. These tests pin
// both halves of that: old data folds once, new data is a preference.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceLayout } from '@/types'
import { useAppStore } from '@/store/app'
import {
  LAYOUT_SCHEMA_VERSION,
  migrateLayoutVisibility,
} from './workspace-layout-version'
import { getWorkspaceLayout } from './database/workspaces'

const selectMock = vi.hoisted(() => vi.fn())
const executeMock = vi.hoisted(() => vi.fn())

vi.mock('./database/connection', () => ({
  selectStrict: selectMock,
  executeQuery: executeMock,
}))

function layout(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspaceId: 'ws-1',
    tabs: [{ id: 'tab-a', label: 'A', type: 'local' }],
    splitGroups: [],
    activeTabId: 'tab-a',
    sidebarVisible: true,
    ...overrides,
  }
}

describe('layout schema migration', () => {
  it('closes the sidebar for a layout written before versioning', () => {
    // No `layoutVersion` field at all: the pre-upgrade case.
    expect(migrateLayoutVisibility({ sidebarVisible: true })).toEqual({
      sidebarVisible: false,
      layoutVersion: LAYOUT_SCHEMA_VERSION,
    })
  })

  it('closes the sidebar for an explicitly version-1 layout', () => {
    expect(
      migrateLayoutVisibility({ sidebarVisible: true, layoutVersion: 1 }),
    ).toEqual({ sidebarVisible: false, layoutVersion: LAYOUT_SCHEMA_VERSION })
  })

  it('honors a closed sidebar in an old layout', () => {
    // Nothing to fold; the value happens to already match the new default.
    expect(migrateLayoutVisibility({ sidebarVisible: false })).toEqual({
      sidebarVisible: false,
      layoutVersion: LAYOUT_SCHEMA_VERSION,
    })
  })

  it('honors an open sidebar at the current version', () => {
    // The whole point of versioning: a user who opened the explorer keeps it.
    expect(
      migrateLayoutVisibility({
        sidebarVisible: true,
        layoutVersion: LAYOUT_SCHEMA_VERSION,
      }),
    ).toEqual({ sidebarVisible: true, layoutVersion: LAYOUT_SCHEMA_VERSION })
  })

  it('honors a closed sidebar at the current version', () => {
    expect(
      migrateLayoutVisibility({
        sidebarVisible: false,
        layoutVersion: LAYOUT_SCHEMA_VERSION,
      }),
    ).toEqual({ sidebarVisible: false, layoutVersion: LAYOUT_SCHEMA_VERSION })
  })

  it('treats a missing boolean at a known version as closed', () => {
    // Corrupt, not a preference. Guessing "open" would restore the regression.
    expect(
      migrateLayoutVisibility({ layoutVersion: LAYOUT_SCHEMA_VERSION }),
    ).toMatchObject({ sidebarVisible: false })
  })

  it('treats a non-numeric version as legacy', () => {
    for (const layoutVersion of ['2', null, {}, Number.NaN, 1.5, -3]) {
      expect(
        migrateLayoutVisibility({ sidebarVisible: true, layoutVersion }),
      ).toMatchObject({ sidebarVisible: false })
    }
  })

  it('honors a future version instead of discarding the choice', () => {
    // This build cannot know what version 9 means, but `sidebarVisible` is still
    // a boolean with the same meaning. Folding it would undo a real user action.
    expect(
      migrateLayoutVisibility({ sidebarVisible: true, layoutVersion: 9 }),
    ).toEqual({ sidebarVisible: true, layoutVersion: LAYOUT_SCHEMA_VERSION })
  })
})

describe('reading a saved layout from the database', () => {
  beforeEach(() => {
    selectMock.mockReset()
    executeMock.mockReset()
  })

  it('migrates a pre-upgrade row on read', async () => {
    selectMock.mockResolvedValue([
      { workspace_id: 'ws-1', layout_data: JSON.stringify(layout()) },
    ])

    const record = await getWorkspaceLayout('ws-1')

    expect(record).toMatchObject({
      sidebarVisible: false,
      layoutVersion: LAYOUT_SCHEMA_VERSION,
    })
  })

  it('leaves recovery data byte-identical through the migration', async () => {
    // tabId, split groups and the active tab are session recovery data. If the
    // migration reshaped them, upgrading would lose the user's terminals — a far
    // worse outcome than an unwanted sidebar.
    const saved = layout({
      tabs: [
        { id: 'tab-a', label: 'A', type: 'local' },
        { id: 'tab-b', label: 'B', type: 'remote', hostId: 'h-1' },
      ],
      splitGroups: [{ id: 'split-1', mode: 'horizontal', tabs: ['tab-a', 'tab-b'], sizes: [60, 40] }],
      activeTabId: 'tab-b',
    })
    selectMock.mockResolvedValue([
      { workspace_id: 'ws-1', layout_data: JSON.stringify(saved) },
    ])

    const record = await getWorkspaceLayout('ws-1')

    expect(record?.tabs).toEqual(saved.tabs)
    expect(record?.splitGroups).toEqual(saved.splitGroups)
    expect(record?.activeTabId).toBe('tab-b')
    expect(record?.workspaceId).toBe('ws-1')
  })

  it('keeps an already-migrated row as it is', async () => {
    selectMock.mockResolvedValue([
      { workspace_id: 'ws-1', layout_data: JSON.stringify(layout({ layoutVersion: LAYOUT_SCHEMA_VERSION })) },
    ])

    const record = await getWorkspaceLayout('ws-1')

    expect(record?.sidebarVisible).toBe(true)
  })

  it('still fails closed on unreadable JSON', async () => {
    // Migration must not turn "the row is corrupt" into "there is no row": the
    // first has to preserve the saved layout and let recovery retry.
    selectMock.mockResolvedValue([{ workspace_id: 'ws-1', layout_data: '{not json' }])

    await expect(getWorkspaceLayout('ws-1')).rejects.toThrow(/not valid JSON/)
  })
})

describe('restoreLayout honors the version, not the raw boolean', () => {
  const base = {
    workspaceId: 'ws-1',
    tabs: [{ id: 'tab-a', label: 'A', type: 'local' as const }],
    splitGroups: [],
    activeTabId: 'tab-a',
  }

  beforeEach(() => {
    useAppStore.setState({ tabs: [], splitGroups: [], activeTabId: null, sidebarVisible: false })
  })

  it('folds the sidebar for a pre-upgrade layout', () => {
    useAppStore.getState().restoreLayout({
      ...base,
      sidebarVisible: true,
    } satisfies WorkspaceLayout)

    expect(useAppStore.getState().sidebarVisible).toBe(false)
    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual(['tab-a'])
  })

  it('restores an open sidebar the user chose at the current version', () => {
    useAppStore.getState().restoreLayout({
      ...base,
      sidebarVisible: true,
      layoutVersion: LAYOUT_SCHEMA_VERSION,
    } satisfies WorkspaceLayout)

    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })

  it('restores a closed sidebar the user chose at the current version', () => {
    useAppStore.setState({ sidebarVisible: true })

    useAppStore.getState().restoreLayout({
      ...base,
      sidebarVisible: false,
      layoutVersion: LAYOUT_SCHEMA_VERSION,
    } satisfies WorkspaceLayout)

    expect(useAppStore.getState().sidebarVisible).toBe(false)
  })

  it('preserves the recovery fields through both branches', () => {
    for (const layoutVersion of [undefined, LAYOUT_SCHEMA_VERSION]) {
      useAppStore.getState().restoreLayout({
        ...base,
        tabs: [
          { id: 'tab-a', label: 'A', type: 'local' },
          { id: 'tab-b', label: 'B', type: 'remote', hostId: 'h-1' },
        ],
        splitGroups: [{ id: 'split-1', mode: 'vertical', tabs: ['tab-a', 'tab-b'], sizes: [50, 50] }],
        activeTabId: 'tab-b',
        sidebarVisible: true,
        ...(layoutVersion === undefined ? {} : { layoutVersion }),
      } satisfies WorkspaceLayout)

      const state = useAppStore.getState()
      expect(state.tabs.map(tab => tab.id)).toEqual(['tab-a', 'tab-b'])
      expect(state.splitGroups).toHaveLength(1)
      expect(state.activeTabId).toBe('tab-b')
    }
  })
})
