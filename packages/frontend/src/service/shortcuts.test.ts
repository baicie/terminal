import { describe, expect, it, beforeEach, vi } from 'vitest'
import { shortcutsService } from './shortcuts'

function makeKeyEvent(
  key: string,
  modifiers: Partial<{
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
    altKey: boolean
  }> = {},
  target?: EventTarget,
): KeyboardEvent {
  const evt = new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: modifiers.altKey ?? false,
    bubbles: true,
    cancelable: true,
  })
  if (target) {
    Object.defineProperty(evt, 'target', { value: target, writable: false })
  }
  return evt
}

describe('shortcutsService.parseKeyboardEvent', () => {
  it('maps Ctrl+J to ["Ctrl", "J"]', () => {
    const e = makeKeyEvent('j', { ctrlKey: true })
    expect(shortcutsService.parseKeyboardEvent(e)).toEqual(['Ctrl', 'J'])
  })

  it('normalizes single letters to upper case', () => {
    const e = makeKeyEvent('a', { ctrlKey: true, shiftKey: true })
    expect(shortcutsService.parseKeyboardEvent(e)).toEqual([
      'Ctrl',
      'Shift',
      'A',
    ])
  })

  it('normalizes special keys (ArrowUp → Up, " " → Space, Escape → Esc)', () => {
    expect(
      shortcutsService.parseKeyboardEvent(makeKeyEvent('ArrowUp')),
    ).toEqual(['Up'])
    expect(shortcutsService.parseKeyboardEvent(makeKeyEvent(' '))).toEqual([
      'Space',
    ])
    expect(shortcutsService.parseKeyboardEvent(makeKeyEvent('Escape'))).toEqual(
      ['Esc'],
    )
  })

  it('skips bare modifier keys (Control, Shift, Alt, Meta)', () => {
    expect(
      shortcutsService.parseKeyboardEvent(makeKeyEvent('Control')),
    ).toEqual([])
    expect(shortcutsService.parseKeyboardEvent(makeKeyEvent('Shift'))).toEqual(
      [],
    )
  })
})

describe('shortcutsService.matchShortcut', () => {
  it('matches Ctrl+K → command-palette (primary binding)', () => {
    const evt = makeKeyEvent('k', { ctrlKey: true })
    const m = shortcutsService.matchShortcut(evt)
    expect(m?.action).toBe('command-palette')
  })

  it('matches Ctrl+J → command-palette (secondary binding)', () => {
    const evt = makeKeyEvent('j', { ctrlKey: true })
    const m = shortcutsService.matchShortcut(evt)
    expect(m?.action).toBe('command-palette')
  })

  it('does not match Ctrl+Shift+K (different modifiers)', () => {
    const evt = makeKeyEvent('k', { ctrlKey: true, shiftKey: true })
    expect(shortcutsService.matchShortcut(evt)).toBeUndefined()
  })

  it('does not match disabled shortcuts', () => {
    const original = shortcutsService.getShortcutByAction('command-palette')!
    shortcutsService.updateShortcut(original.id, { enabled: false })
    const evt = makeKeyEvent('j', { ctrlKey: true })
    expect(shortcutsService.matchShortcut(evt)).toBeUndefined()
    shortcutsService.updateShortcut(original.id, { enabled: true })
  })

  it('does not reserve the Windows and Linux paste shortcut', () => {
    const evt = makeKeyEvent('v', { ctrlKey: true, shiftKey: true })

    expect(shortcutsService.matchShortcut(evt)).toBeUndefined()
  })

  it('matches Ctrl+Shift+Backslash for vertical split', () => {
    // On common keyboard layouts Shift+Backslash is reported as "|".
    const evt = makeKeyEvent('|', { ctrlKey: true, shiftKey: true })

    expect(shortcutsService.matchShortcut(evt)?.action).toBe('split-vertical')
  })
})

describe('shortcutsService.handleKeyboardEvent', () => {
  beforeEach(() => {
    shortcutsService.resetToDefault()
  })

  it('triggers action and prevents default', () => {
    const handler = vi.fn()
    const off = shortcutsService.addListener(handler)

    const evt = makeKeyEvent('j', { ctrlKey: true })
    const preventSpy = vi.spyOn(evt, 'preventDefault')
    const result = shortcutsService.handleKeyboardEvent(evt)

    expect(result).toBe(true)
    expect(preventSpy).toHaveBeenCalled()
    expect(handler).toHaveBeenCalledWith('command-palette')
    off()
  })

  it('lets editable targets through for non-whitelisted actions', () => {
    const handler = vi.fn()
    const off = shortcutsService.addListener(handler)
    const input = document.createElement('input')

    // Ctrl+W (close-tab) inside an input should NOT fire
    const evt = makeKeyEvent('w', { ctrlKey: true }, input)
    const result = shortcutsService.handleKeyboardEvent(evt)
    expect(result).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    off()
  })

  it('still fires whitelisted opening actions (Ctrl+J/K) inside inputs', () => {
    const handler = vi.fn()
    const off = shortcutsService.addListener(handler)
    const input = document.createElement('input')

    // Ctrl+J is whitelisted so it fires even when focus is in an input
    const evt = makeKeyEvent('j', { ctrlKey: true }, input)
    shortcutsService.handleKeyboardEvent(evt)
    expect(handler).toHaveBeenCalledWith('command-palette')
    off()
  })
})

describe('shortcutsService.import/export', () => {
  it('round-trips shortcuts through JSON', () => {
    shortcutsService.resetToDefault()
    const json = shortcutsService.exportShortcuts()
    const before = shortcutsService.getShortcuts()

    const ok = shortcutsService.importShortcuts(json)
    expect(ok).toBe(true)
    const after = shortcutsService.getShortcuts()
    expect(after).toEqual(before)
  })

  it('rejects invalid JSON', () => {
    expect(shortcutsService.importShortcuts('not-json')).toBe(false)
    expect(shortcutsService.importShortcuts('{"foo":1}')).toBe(false)
  })
})
