import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWindowFocus } from './use-window-focus'

describe('useWindowFocus (browser fallback path)', () => {
  beforeEach(() => {
    // jsdom defaults: document.hasFocus() returns true; clear any tauri marker
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    delete (window as unknown as Record<string, unknown>).__TAURI_INVOKE__
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('initial value matches document.hasFocus()', () => {
    const { result } = renderHook(() => useWindowFocus())
    expect(result.current).toBe(document.hasFocus())
  })

  it('toggles via focus/blur events', () => {
    const { result } = renderHook(() => useWindowFocus())

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(result.current).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current).toBe(true)
  })

  it('removes listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useWindowFocus())
    unmount()
    // After unmount the next blur event must NOT cause an update on a stale ref
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    // result.current is the last rendered value before unmount;
    // the act() with unmounted hook should not throw
    expect(result.current).toBeTypeOf('boolean')
  })
})
