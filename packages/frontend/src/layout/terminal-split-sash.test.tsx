import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalSplitSash } from './terminal-split-sash'

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly isPrimary: boolean

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
    this.isPrimary = init.isPrimary ?? true
  }
}

describe('TerminalSplitSash', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(0), 16)
    })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      window.clearTimeout(handle)
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('adjusts a horizontal layout with the left and right arrow keys', () => {
    const onChange = vi.fn()
    render(
      <TerminalSplitSash
        direction="horizontal"
        value={50}
        onChange={onChange}
      />,
    )

    const sash = screen.getByRole('separator')
    fireEvent.keyDown(sash, { key: 'ArrowLeft' })
    fireEvent.keyDown(sash, { key: 'ArrowRight' })

    expect(onChange).toHaveBeenNthCalledWith(1, 45, true)
    expect(onChange).toHaveBeenNthCalledWith(2, 55, true)
  })

  it('uses up and down keys for a vertical layout', () => {
    const onChange = vi.fn()
    render(
      <TerminalSplitSash direction="vertical" value={40} onChange={onChange} />,
    )

    const sash = screen.getByRole('separator')
    fireEvent.keyDown(sash, { key: 'ArrowUp' })
    fireEvent.keyDown(sash, { key: 'ArrowDown' })

    expect(onChange).toHaveBeenNthCalledWith(1, 35, true)
    expect(onChange).toHaveBeenNthCalledWith(2, 45, true)
  })

  it('supports boundary and reset keyboard actions', () => {
    const onChange = vi.fn()
    render(
      <TerminalSplitSash
        direction="horizontal"
        value={63}
        onChange={onChange}
      />,
    )

    const sash = screen.getByRole('separator')
    fireEvent.keyDown(sash, { key: 'Home' })
    fireEvent.keyDown(sash, { key: 'End' })
    fireEvent.keyDown(sash, { key: 'Enter' })
    fireEvent.doubleClick(sash)

    expect(onChange).toHaveBeenNthCalledWith(1, 20, true)
    expect(onChange).toHaveBeenNthCalledWith(2, 80, true)
    expect(onChange).toHaveBeenNthCalledWith(3, 50, true)
    expect(onChange).toHaveBeenNthCalledWith(4, 50, true)
  })

  it('exposes its orientation and current value to assistive technology', () => {
    render(
      <TerminalSplitSash direction="vertical" value={42} onChange={() => {}} />,
    )

    const sash = screen.getByRole('separator')
    expect(sash.getAttribute('aria-orientation')).toBe('horizontal')
    expect(sash.getAttribute('aria-valuenow')).toBe('42')
    expect(sash.getAttribute('tabindex')).toBe('0')
  })

  it('keeps a 4px visual sash with a 20px pointer hit target', () => {
    const { rerender } = render(
      <TerminalSplitSash
        direction="horizontal"
        value={50}
        onChange={() => {}}
      />,
    )

    const sash = screen.getByRole('separator')
    expect(sash.style.width).toBe('4px')
    expect(sash.style.height).toBe('')
    expect(sash.className).toContain('before:-inset-x-2')
    expect(sash.className).toContain('before:inset-y-0')

    rerender(
      <TerminalSplitSash direction="vertical" value={50} onChange={() => {}} />,
    )
    expect(sash.style.width).toBe('')
    expect(sash.style.height).toBe('4px')
    expect(sash.className).toContain('before:inset-x-0')
    expect(sash.className).toContain('before:-inset-y-2')
  })

  it('drags from pointer coordinates and clamps the result to 20/80', () => {
    const onChange = vi.fn()
    const { container } = render(
      <div>
        <TerminalSplitSash
          direction="horizontal"
          value={50}
          onChange={onChange}
        />
      </div>,
    )
    const parent = container.firstElementChild as HTMLDivElement
    const sash = screen.getByRole('separator') as HTMLDivElement
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 40,
      left: 100,
      top: 40,
      right: 300,
      bottom: 140,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })
    sash.setPointerCapture = vi.fn()
    sash.hasPointerCapture = vi.fn(() => true)
    sash.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(sash, { pointerId: 7, button: 0, clientX: 200 })
    fireEvent.pointerMove(sash, { pointerId: 7, clientX: 110 })
    act(() => vi.advanceTimersByTime(16))
    fireEvent.pointerMove(sash, { pointerId: 7, clientX: 290 })
    act(() => vi.advanceTimersByTime(16))
    fireEvent.pointerUp(sash, { pointerId: 7, clientX: 260 })

    expect(sash.setPointerCapture).toHaveBeenCalledWith(7)
    expect(onChange).toHaveBeenNthCalledWith(1, 20, false)
    expect(onChange).toHaveBeenNthCalledWith(2, 80, false)
    expect(onChange).toHaveBeenNthCalledWith(3, 80, true)
    expect(sash.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('ends a canceled drag at the last valid value and ignores later moves', () => {
    const onChange = vi.fn()
    const { container } = render(
      <div>
        <TerminalSplitSash
          direction="vertical"
          value={50}
          onChange={onChange}
        />
      </div>,
    )
    const parent = container.firstElementChild as HTMLDivElement
    const sash = screen.getByRole('separator') as HTMLDivElement
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 100,
      left: 0,
      top: 100,
      right: 100,
      bottom: 300,
      width: 100,
      height: 200,
      toJSON: () => ({}),
    })
    sash.setPointerCapture = vi.fn()
    sash.hasPointerCapture = vi.fn(() => true)
    sash.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(sash, { pointerId: 9, button: 0, clientY: 200 })
    fireEvent.pointerMove(sash, { pointerId: 9, clientY: 220 })
    act(() => vi.advanceTimersByTime(16))
    fireEvent.pointerCancel(sash, { pointerId: 9, clientY: 0 })
    fireEvent.pointerMove(sash, { pointerId: 9, clientY: 260 })

    expect(onChange).toHaveBeenNthCalledWith(1, 60, false)
    expect(onChange).toHaveBeenNthCalledWith(2, 60, true)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(sash.releasePointerCapture).toHaveBeenCalledWith(9)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('cancels pending work and releases capture when unmounted mid-drag', () => {
    const onChange = vi.fn()
    const { container, unmount } = render(
      <div>
        <TerminalSplitSash
          direction="horizontal"
          value={50}
          onChange={onChange}
        />
      </div>,
    )
    const parent = container.firstElementChild as HTMLDivElement
    const sash = screen.getByRole('separator') as HTMLDivElement
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })
    sash.setPointerCapture = vi.fn()
    sash.hasPointerCapture = vi.fn(() => true)
    sash.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(sash, { pointerId: 11, button: 0, clientX: 100 })
    fireEvent.pointerMove(sash, { pointerId: 11, clientX: 120 })
    unmount()
    act(() => vi.advanceTimersByTime(16))

    expect(onChange).not.toHaveBeenCalled()
    expect(sash.releasePointerCapture).toHaveBeenCalledWith(11)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })
})
