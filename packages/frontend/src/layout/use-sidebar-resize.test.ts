import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_WIDTH_KEY } from './sidebar-width'
import { useSidebarResize } from './use-sidebar-resize'

function keyEvent(key: string, shiftKey = false) {
  return {
    key,
    shiftKey,
    preventDefault: vi.fn(),
  } as unknown as ReactKeyboardEvent
}

beforeEach(() => {
  localStorage.clear()
})

describe('useSidebarResize keyboard', () => {
  it('adjusts by a step and with shift, and persists the width', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useSidebarResize(200, onChange))

    act(() => result.current.onResizeKeyDown(keyEvent('ArrowRight')))
    expect(onChange).toHaveBeenLastCalledWith(208)
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe('208')

    act(() => result.current.onResizeKeyDown(keyEvent('ArrowLeft', true)))
    expect(onChange).toHaveBeenLastCalledWith(168)
  })

  it('clamps to the configured bounds with Home and End', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useSidebarResize(200, onChange))

    act(() => result.current.onResizeKeyDown(keyEvent('Home')))
    expect(onChange).toHaveBeenLastCalledWith(SIDEBAR_MIN)

    act(() => result.current.onResizeKeyDown(keyEvent('End')))
    expect(onChange).toHaveBeenLastCalledWith(SIDEBAR_MAX)
  })

  it('ignores unrelated keys', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useSidebarResize(200, onChange))
    const event = keyEvent('Enter')

    act(() => result.current.onResizeKeyDown(event))

    expect(onChange).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
