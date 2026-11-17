// The Context Dock's single-occupant contract.
//
// The left column learned this in UX-1b: `sftpOpen` + `snippetsOpen` can both be
// true, and then two panels stack or one silently wins by render order. These tests
// pin the rule that makes "two open" unrepresentable, so adding `snippets`,
// `inspector` or `ai` in UX-3/UX-4 cannot reintroduce it.

import { describe, expect, it } from 'vitest'
import {
  IMPLEMENTED_RIGHT_PANEL_OCCUPANTS,
  RIGHT_PANEL_OCCUPANTS,
  isRightPanelImplemented,
  occupantOwnsSession,
  resolveRightPanelMode,
  toggleRightPanel,
  withRightPanel,
} from './right-panel-state'

describe('the occupant is one value, never two booleans', () => {
  it('every mode is a single string, so two cannot both be set', () => {
    // The contract in one assertion: state is `{ rightPanel: <one of these> }`.
    // There is no shape in which two occupants coexist, which is why this cannot
    // regress the way a pair of flags did on the left column.
    for (const mode of RIGHT_PANEL_OCCUPANTS) {
      const state = withRightPanel(mode)
      expect(Object.keys(state)).toEqual(['rightPanel'])
      expect(typeof state.rightPanel).toBe('string')
    }
  })

  it('opening one replaces whatever was open', () => {
    // Not "adds to": the previous occupant is gone, not stacked behind.
    for (const from of RIGHT_PANEL_OCCUPANTS) {
      for (const to of RIGHT_PANEL_OCCUPANTS) {
        expect(withRightPanel(from).rightPanel).toBe(from)
        expect(withRightPanel(to)).toEqual({ rightPanel: to })
      }
    }
  })
})

describe('the toggle', () => {
  it('opens from closed and closes from anything open', () => {
    expect(toggleRightPanel('none').rightPanel).toBe('sftp')
    for (const open of RIGHT_PANEL_OCCUPANTS.filter(mode => mode !== 'none')) {
      expect(toggleRightPanel(open).rightPanel, `closing ${open}`).toBe('none')
    }
  })

  it('never switches to a panel the user did not ask for', () => {
    // Toggling an open `ai` (once it exists) must close, not become `sftp`. A
    // toggle that swapped occupants would make the close button unpredictable.
    expect(toggleRightPanel('ai').rightPanel).toBe('none')
    expect(toggleRightPanel('snippets').rightPanel).toBe('none')
    expect(toggleRightPanel('inspector').rightPanel).toBe('none')
  })
})

describe('which occupants this build renders', () => {
  it('declares future occupants in the union but implements only what ships', () => {
    // The union is the contract; the implemented list is the truth. This is the
    // line that stops "declared" from being read as "ready".
    expect([...RIGHT_PANEL_OCCUPANTS]).toContain('snippets')
    expect([...RIGHT_PANEL_OCCUPANTS]).toContain('inspector')
    expect([...RIGHT_PANEL_OCCUPANTS]).toContain('ai')
    // Each occupant moved here when its view shipped, through the contract rather than
    // beside it: `snippets` with the snippet dock, `ai` with the assistant dock.
    // `inspector` stays declared-but-not-built.
    expect([...IMPLEMENTED_RIGHT_PANEL_OCCUPANTS]).toEqual([
      'none',
      'sftp',
      'snippets',
      'ai',
    ])
    expect(isRightPanelImplemented('sftp')).toBe(true)
    expect(isRightPanelImplemented('snippets')).toBe(true)
    expect(isRightPanelImplemented('ai')).toBe(true)
    expect(isRightPanelImplemented('inspector')).toBe(false)
  })

  it('stays closed rather than rendering an empty panel for a future occupant', () => {
    // Falling back to a *different* panel would open something the user did not
    // choose; falling back to `none` keeps the dock closed and says nothing false.
    expect(resolveRightPanelMode('inspector')).toBe('none')
    // The ones that shipped are kept.
    expect(resolveRightPanelMode('snippets')).toBe('snippets')
    expect(resolveRightPanelMode('ai')).toBe('ai')
  })

  it('keeps the implemented modes it was given', () => {
    expect(resolveRightPanelMode('sftp')).toBe('sftp')
    expect(resolveRightPanelMode('none')).toBe('none')
  })

  it('treats garbage from persisted state as closed', () => {
    // Persisted layout is user-editable text and can name a panel from a future
    // build, a typo, or nothing at all.
    for (const junk of [null, undefined, '', 'SFTP', 'sftp ', 'unknown', '{}']) {
      expect(resolveRightPanelMode(junk), `junk ${String(junk)}`).toBe('none')
    }
  })
})

describe('the dock never owns a session', () => {
  it('reports false for every occupant', () => {
    // `INV-13`/`INV-14` in one line: a panel remount is not a lifecycle event. An
    // occupant that answered true would be asking the shell to open a connection
    // because a panel opened, which inverts the ownership the architecture sets.
    expect(occupantOwnsSession()).toBe(false)
  })
})
