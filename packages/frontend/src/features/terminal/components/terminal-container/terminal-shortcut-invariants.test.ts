// UX-1a — the shortcut surface must not change when the shell around it does.
//
// This phase replaces the top toolbar, adds an activity rail and a status bar.
// Every one of those is a place where a global key listener can be added, and the
// terminal is the one surface where a wrong listener is immediately destructive:
// it steals a keystroke the shell was supposed to receive.
//
// The tests here pin the layers that already exist, so a new component has to be
// added *around* them rather than on top of them.

import { describe, expect, it } from 'vitest'
import {
  isEditableShortcutTarget,
  shouldHandleShortcutInEditableTarget,
} from '@/service/shortcut-keyboard'
import { shortcutsService } from '@/service/shortcuts'

describe('editable targets keep the keyboard', () => {
  it('does not treat a textarea or input as ours to consume', () => {
    for (const tag of ['TEXTAREA', 'INPUT']) {
      const element = document.createElement(tag)
      document.body.appendChild(element)
      expect(isEditableShortcutTarget(element)).toBe(true)
      document.body.removeChild(element)
    }
  })

  it('lets only the reviewed actions run inside an editable target', () => {
    // Without this allow-list, typing a host name in a dialog would open the
    // palette and lose the field. The five names are the ones the settings UI and
    // the command palette actually need while an input has focus.
    for (const action of [
      'command-palette',
      'toggle-sidebar',
      'new-tab',
      'new-local',
      'new-ssh',
    ]) {
      expect(shouldHandleShortcutInEditableTarget(action)).toBe(true)
    }
    for (const action of ['close-tab', 'split-horizontal', 'next-tab', 'search-terminal']) {
      expect(shouldHandleShortcutInEditableTarget(action)).toBe(false)
    }
  })
})

describe('no default binding shadows a shell key', () => {
  it('binds nothing to a bare control letter outside the reviewed set', () => {
    // `DEFAULT_SHELL_CTRL_BINDINGS` names the bound control keys handed back to
    // the shell on macOS. Any new bare `Ctrl+<letter>` binding outside this set is
    // a key the shell loses. `F` is included because it is already bound today —
    // that gap is recorded, not fixed, in this phase.
    const REVIEWED = new Set(['J', 'K', 'L', 'W', 'T', 'B', 'F'])
    const offenders: string[] = []
    for (const shortcut of shortcutsService.getShortcuts()) {
      if (shortcut.keys.length !== 2 || shortcut.keys[0] !== 'Ctrl') continue
      const key = shortcut.keys[1]
      // Letters only: zoom binds Ctrl+= / Ctrl+- / Ctrl+0, which readline does not
      // use and which are not the class of key this test is about.
      if (/^[A-Z]$/.test(key) && !REVIEWED.has(key)) offenders.push(key)
    }
    expect(offenders).toEqual([])
  })
})

describe('the palette keeps its own key', () => {
  it('is still reachable from a control binding', () => {
    const palette = shortcutsService
      .getShortcuts()
      .find(shortcut => shortcut.action === 'command-palette' && shortcut.enabled)
    expect(palette).toBeDefined()
    expect(palette!.keys[0]).toBe('Ctrl')
  })
})
