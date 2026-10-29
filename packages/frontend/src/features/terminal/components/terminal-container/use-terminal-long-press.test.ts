import { act, renderHook } from '@testing-library/react'
import type { TouchEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalLongPress } from './use-terminal-long-press'

function touchEvent(x = 10, y = 20) {
  return {
    touches: [{ clientX: x, clientY: y }],
  } as unknown as TouchEvent<HTMLDivElement>
}

describe('useTerminalLongPress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens once after the hold threshold', () => {
    const onOpen = vi.fn()
    const { result } = renderHook(() => useTerminalLongPress(onOpen))

    act(() => result.current.start(touchEvent()))
    act(() => vi.advanceTimersByTime(500))
    act(() => result.current.cancel())

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('cancels the pending callback when the pane unmounts', () => {
    const onOpen = vi.fn()
    const { result, unmount } = renderHook(() => useTerminalLongPress(onOpen))

    act(() => result.current.start(touchEvent()))
    unmount()
    act(() => vi.advanceTimersByTime(500))

    expect(onOpen).not.toHaveBeenCalled()
  })
})
