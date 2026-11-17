// Publishing the terminal's selection for capability-gated readers.
//
// The rule this encodes is the whole reason `terminal.read-selected` is a capability
// rather than a store read: an extension may see the text the user selected *in the
// session they are looking at*, and nothing else. A background tab's selection is
// text they highlighted on a host they have since left.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetTerminalSelectionForTests,
  clearTerminalSelection,
  currentTerminalSelection,
  publishTerminalSelection,
  subscribeTerminalSelection,
} from './terminal-selection'

beforeEach(() => {
  __resetTerminalSelectionForTests()
})

describe('publishing a selection', () => {
  it('reports what was published', () => {
    publishTerminalSelection('tab-1', 'kubectl get pods')
    expect(currentTerminalSelection()).toMatchObject({
      text: 'kubectl get pods',
      sessionId: 'tab-1',
    })
  })

  it('publishing null clears it', () => {
    publishTerminalSelection('tab-1', 'ls')
    publishTerminalSelection('tab-1', null)
    expect(currentTerminalSelection()).toBeNull()
  })

  it('publishing an empty string clears it rather than reporting ""', () => {
    // xterm reports an empty selection when the user clicks elsewhere. An empty
    // string would let an extension think it captured something.
    publishTerminalSelection('tab-1', 'ls')
    publishTerminalSelection('tab-1', '')
    expect(currentTerminalSelection()).toBeNull()
  })

  it('one session clearing does not clear another session\'s selection', () => {
    // Two containers mount and unmount independently; a stale one must not wipe the
    // active one's selection.
    publishTerminalSelection('tab-2', 'from tab 2')
    clearTerminalSelection('tab-1')
    expect(currentTerminalSelection()).toMatchObject({ text: 'from tab 2', sessionId: 'tab-2' })
  })

  it('the latest publish wins', () => {
    publishTerminalSelection('tab-1', 'first')
    publishTerminalSelection('tab-1', 'second')
    expect(currentTerminalSelection()?.text).toBe('second')
  })

  it('reports null before anything was published', () => {
    expect(currentTerminalSelection()).toBeNull()
  })
})

  it('gives every publish a new identity', () => {
    // The approval binding needs this. Within one tab the user selects, selects
    // something else, and selects the original text again — an approval minted for
    // the first must not authorise the third, so the id has to change on every
    // gesture, including a re-selection of identical text.
    publishTerminalSelection('tab-1', 'ls')
    const first = currentTerminalSelection()?.seq
    publishTerminalSelection('tab-1', 'ls')
    const second = currentTerminalSelection()?.seq
    expect(first).not.toBe(second)
  })

describe('the selection notifies subscribers', () => {
  it('calls a subscriber when a selection is published', () => {
    // The AI dock reads this value while rendering. A module-level read with no
    // notification means selecting text after the dock is open never reaches it —
    // the dock stays on "select something" while text is visibly selected.
    const seen: Array<string | null> = []
    const unsubscribe = subscribeTerminalSelection(() => {
      seen.push(currentTerminalSelection()?.text ?? null)
    })
    publishTerminalSelection('tab-1', 'ls -la')
    unsubscribe()
    expect(seen).toEqual(['ls -la'])
  })

  it('calls a subscriber when the selection is cleared', () => {
    const seen: Array<string | null> = []
    publishTerminalSelection('tab-1', 'ls')
    const unsubscribe = subscribeTerminalSelection(() => {
      seen.push(currentTerminalSelection()?.text ?? null)
    })
    publishTerminalSelection('tab-1', null)
    unsubscribe()
    expect(seen).toEqual([null])
  })

  it('stops calling after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribeTerminalSelection(() => {
      calls += 1
    })
    unsubscribe()
    publishTerminalSelection('tab-1', 'ls')
    expect(calls).toBe(0)
  })

  it('a throwing subscriber does not stop the others', () => {
    // One broken component must not stop the dock from updating.
    const seen: string[] = []
    const unsubscribeBad = subscribeTerminalSelection(() => {
      throw new Error('broken subscriber')
    })
    const unsubscribeGood = subscribeTerminalSelection(() => {
      seen.push('ok')
    })
    publishTerminalSelection('tab-1', 'ls')
    unsubscribeBad()
    unsubscribeGood()
    expect(seen).toEqual(['ok'])
  })
})
