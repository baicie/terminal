// The dock must see a selection made *after* it opened.
//
// The defect this pins: `RightPanel` read `currentTerminalSelection()` once during
// render with no subscription. Opening the dock first and selecting text second left it
// showing "select something" while text was visibly selected — and that is the normal
// order, because the user opens the assistant and then highlights what to ask about.

import { act, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetTerminalSelectionForTests,
  currentTerminalSelection,
  publishTerminalSelection,
  subscribeTerminalSelection,
} from '@/features/terminal/services/terminal-selection'

/** The exact shape `RightPanel` uses: a tick plus a read on each render. */
function SelectionProbe() {
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeTerminalSelection(() => setTick(value => value + 1)), [])
  void tick
  const selection = currentTerminalSelection()
  return <p data-testid="probe">{selection?.text ?? 'nothing'}</p>
}

beforeEach(() => {
  __resetTerminalSelectionForTests()
})

describe('a selection made after mount reaches the subscriber', () => {
  it('re-renders with the new text', () => {
    render(<SelectionProbe />)
    expect(screen.getByTestId('probe').textContent).toBe('nothing')

    act(() => {
      publishTerminalSelection('tab-1', 'kubectl get pods')
    })

    expect(screen.getByTestId('probe').textContent).toBe('kubectl get pods')
  })

  it('re-renders when the selection is cleared', () => {
    render(<SelectionProbe />)
    act(() => {
      publishTerminalSelection('tab-1', 'ls')
    })
    expect(screen.getByTestId('probe').textContent).toBe('ls')

    act(() => {
      publishTerminalSelection('tab-1', null)
    })
    expect(screen.getByTestId('probe').textContent).toBe('nothing')
  })

  it('stops updating after unmount', () => {
    const { unmount } = render(<SelectionProbe />)
    unmount()
    // A publish after unmount must not throw (the listener is gone) and must not warn.
    expect(() => {
      act(() => {
        publishTerminalSelection('tab-1', 'late')
      })
    }).not.toThrow()
  })
})
