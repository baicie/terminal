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
    shortcutsService.updateShortcut(search.id, { keys: ['Ctrl', 'L'] })
    const listener = vi.fn()
    const removeListener = shortcutsService.addListener(listener)

    expect(handleXtermShortcut(keydown('l', { ctrlKey: true }), true)).toBe(
      false,
    )
    expect(listener).toHaveBeenCalledWith('search-terminal')
    removeListener()
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
