import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHORTCUT_EVENT_PREFIX } from '@/hooks/use-global-shortcuts'
import { shortcutsService } from '@/service/shortcuts'
import {
  handleXtermShortcut,
  useTerminalShortcutEvents,
} from './use-terminal-shortcut-events'

function keydown(
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>
  > = {},
) {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.ctrlKey,
    metaKey: modifiers.metaKey,
    shiftKey: modifiers.shiftKey,
    cancelable: true,
  })
}

describe('handleXtermShortcut', () => {
  afterEach(() => shortcutsService.resetToDefault())

  it('uses the configured binding and prevents it from reaching the shell', () => {
    const search = shortcutsService.getShortcutByAction('search-terminal')!
    shortcutsService.updateShortcut(search.id, { keys: ['Ctrl', 'G'] })
    const listener = vi.fn()
    const removeListener = shortcutsService.addListener(listener)
    const event = keydown('g', { ctrlKey: true })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')

    expect(handleXtermShortcut(event, true)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith('search-terminal')
    removeListener()
  })

  it('allows shell input when the terminal pane is inactive', () => {
    const listener = vi.fn()
    const removeListener = shortcutsService.addListener(listener)
    const event = keydown('l', { ctrlKey: true })

    expect(handleXtermShortcut(event, false)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    removeListener()
  })

  it('dispatches configured layout shortcuts from the xterm input surface', () => {
    const closeTab = shortcutsService.getShortcutByAction('close-tab')!
    shortcutsService.updateShortcut(closeTab.id, {
      keys: ['Ctrl', 'Shift', 'W'],
    })
    const listener = vi.fn()
    const removeListener = shortcutsService.addListener(listener)

    expect(
      handleXtermShortcut(
        keydown('w', { ctrlKey: true, shiftKey: true }),
        true,
      ),
    ).toBe(false)
    expect(listener).toHaveBeenCalledWith('close-tab')
    removeListener()
  })

  it.each([
    ['b', 'toggle-sidebar'],
    ['j', 'command-palette'],
    ['k', 'command-palette'],
    ['l', 'clear-terminal'],
    ['t', 'new-tab'],
    ['w', 'close-tab'],
  ])('lets physical Ctrl+%s reach the shell instead of %s', (key, action) => {
    const listener = vi.fn()
    const removeListener = shortcutsService.addListener(listener)
    const event = keydown(key, { ctrlKey: true })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')

    expect(handleXtermShortcut(event, true)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(listener).not.toHaveBeenCalledWith(action)
    removeListener()
  })

  it('keeps shifted terminal layout shortcuts in the application', () => {
    const listener = vi.fn()
    const removeListener = shortcutsService.addListener(listener)
    const event = keydown('h', { ctrlKey: true, shiftKey: true })

    expect(handleXtermShortcut(event, true)).toBe(false)
    expect(listener).toHaveBeenCalledWith('split-horizontal')
    removeListener()
  })

  it('lets a remapped Ctrl binding run as an application command', () => {
    const search = shortcutsService.getShortcutByAction('search-terminal')!
    // Ctrl+L already belongs to Clear Terminal; a remap onto a bound key is now
    // refused, so this uses a combination nothing else holds.
    expect(
      shortcutsService.updateShortcut(search.id, { keys: ['Ctrl', 'Shift', 'F'] }),
    ).toBe(true)
    const listener = vi.fn()
    const removeListener = shortcutsService.addListener(listener)

    expect(
      handleXtermShortcut(
        keydown('f', { ctrlKey: true, shiftKey: true }),
        true,
      ),
    ).toBe(false)
    expect(listener).toHaveBeenCalledWith('search-terminal')
    removeListener()
    shortcutsService.resetToDefault()
  })
})

describe('useTerminalShortcutEvents', () => {
  const handlers = {
    onReconnect: vi.fn(),
    onClear: vi.fn(),
    onSearch: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
  }

  afterEach(() => vi.clearAllMocks())

  it('only executes terminal actions for the active pane', () => {
    const { rerender } = renderHook(
      ({ active }) => useTerminalShortcutEvents({ active, ...handlers }),
      { initialProps: { active: false } },
    )

    act(() => {
      window.dispatchEvent(
        new CustomEvent(`${SHORTCUT_EVENT_PREFIX}clear-terminal`),
      )
    })
    expect(handlers.onClear).not.toHaveBeenCalled()

    rerender({ active: true })
    act(() => {
      window.dispatchEvent(
        new CustomEvent(`${SHORTCUT_EVENT_PREFIX}clear-terminal`),
      )
    })
    expect(handlers.onClear).toHaveBeenCalledOnce()
  })
})

// UX-1a — the keys readline needs must keep reaching the shell.
//
// The layout work in this phase adds an activity rail and a status bar, and the
// obvious way to wire a rail is "one key per destination". That is exactly how a
// terminal app loses readline: Ctrl+P (previous command), Ctrl+N (next command)
// and Ctrl+R (reverse search) are three of the most-used keys in a shell, and
// nothing in this repository protects them today.
//
// These tests exist before the layout changes so the changes cannot quietly take
// them. They assert today's behaviour, which is already correct: an unbound
// control key is left alone for the terminal.
describe('readline keys are never taken by the application', () => {
  // `f` is deliberately absent: `Ctrl+F` is bound to `search-terminal` today and
  // therefore never reaches the shell, which breaks readline's forward-char. It is
  // pre-existing behaviour, recorded in `docs/design/terminal-next/02-*.md` and in
  // the UX-1a delivery notes rather than changed here — taking it back would be a
  // product decision about search, not a side effect of a layout change.
  const readlineKeys = ['p', 'n', 'r', 'a', 'e', 'u', 'y', 'd', 'c']

  it.each(readlineKeys)('leaves physical Ctrl+%s to the shell', key => {
    const event = keydown(key.toUpperCase(), { ctrlKey: true })
    // Not active means "this pane is not the foreground terminal", which is the
    // one case where the app is allowed to act. Here it is active.
    const reachedShell = handleXtermShortcut(event, true)
    expect(reachedShell).toBe(true)
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not have any default binding on Ctrl+P, Ctrl+N or Ctrl+R', () => {
    // A binding would turn these into application actions the moment someone
    // presses them in a shell. Pinned by name so adding one has to be deliberate.
    const bound = shortcutsService
      .getShortcuts()
      .map(shortcut => shortcut.keys.join('+'))
    for (const key of ['Ctrl+P', 'Ctrl+N', 'Ctrl+R']) {
      expect(bound).not.toContain(key)
    }
  })

  it('still lets the bound control keys reach the shell', () => {
    // The inverse, so a future "cleanup" of DEFAULT_SHELL_CTRL_BINDINGS that
    // removed these would fail here rather than in a user's shell.
    for (const key of ['J', 'K', 'L', 'W', 'T', 'B']) {
      const event = keydown(key, { ctrlKey: true })
      expect(handleXtermShortcut(event, true)).toBe(true)
      expect(event.defaultPrevented).toBe(false)
    }
  })
})

describe('a shortcut with a modifier is the application\'s, not the shell\'s', () => {
  // `parseShortcutKeyboardEvent` maps `metaKey` to `Ctrl` only on a Mac platform.
  // jsdom reports a Linux platform, so the tests that care about Cmd have to say
  // so explicitly — otherwise they would be asserting Linux behaviour under a
  // macOS name.
  function asMac<T>(run: () => T): T {
    const original = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(navigator),
      'platform',
    )
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })
    try {
      return run()
    } finally {
      if (original) {
        Object.defineProperty(Object.getPrototypeOf(navigator), 'platform', original)
      }
    }
  }

  it('Cmd+K opens the palette instead of reaching the terminal', () => {
    asMac(() => {
      const event = keydown('k', { metaKey: true })
      const reachedShell = handleXtermShortcut(event, true)
      expect(reachedShell).toBe(false)
      expect(event.defaultPrevented).toBe(true)
    })
  })

  it('leaves every key alone while the pane is not the active terminal', () => {
    // A background pane must not consume shortcuts: the rail, the explorer and
    // any dialog need the keyboard while the terminal is not focused.
    asMac(() => {
      for (const key of ['k', 't', 'w']) {
        const event = keydown(key, { metaKey: true })
        expect(handleXtermShortcut(event, false)).toBe(true)
        expect(event.defaultPrevented).toBe(false)
      }
    })
  })
})
