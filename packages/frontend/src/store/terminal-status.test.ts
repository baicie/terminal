// The terminal status store must survive being published to after a clear.
//
// ## The defect this pins
//
// The `unchanged` guard was written as a chain of `&&` comparisons whose first clause
// used optional chaining:
//
//   state.active?.tabId === snapshot.tabId &&
//   state.active.cols === snapshot.cols &&   // ← throws when active is null
//
// `&&` short-circuits, so the undefined read only happens when the first comparison is
// **true** — which is exactly the case where `active` is null and the tab id matches,
// i.e. never for a different tab and always for a re-publish after `clear()`. Measured
// on the macOS GUI run: `publish` threw on every call and the status bar never became
// readable, which failed e2e-02's three geometry cases.
//
// The sequence below is the one the product actually performs: a background tab clears
// the slot, then the active tab publishes.

import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalStatusStore } from './terminal-status'

const snapshot = {
  tabId: 'tab-a',
  cols: 120,
  rows: 30,
  status: 'connected' as const,
  sessionType: 'remote' as const,
  fittedWidth: 1024,
}

describe('terminal status store', () => {
  beforeEach(() => {
    useTerminalStatusStore.setState({ active: null, fittedWidth: 0 })
  })

  it('accepts a publish into an empty slot', () => {
    /*
     * The null-`active` branch is exercised here without a preceding publish: this is
     * the first frame of every session, and it is where the crash lived.
     */
    expect(() => useTerminalStatusStore.getState().publish(snapshot)).not.toThrow()
    expect(useTerminalStatusStore.getState().active?.cols).toBe(120)
    expect(useTerminalStatusStore.getState().fittedWidth).toBe(1024)
  })

  it('accepts a publish after a clear', () => {
    const store = useTerminalStatusStore.getState()
    store.publish(snapshot)
    store.clear(snapshot.tabId)
    expect(useTerminalStatusStore.getState().active).toBeNull()

    // The failing sequence: publish again for the same tab after the slot was cleared.
    expect(() => useTerminalStatusStore.getState().publish(snapshot)).not.toThrow()
    expect(useTerminalStatusStore.getState().active?.tabId).toBe('tab-a')
  })

  it('clears the observed width with the snapshot', () => {
    useTerminalStatusStore.getState().publish(snapshot)
    useTerminalStatusStore.getState().clear(snapshot.tabId)
    /*
     * A stale width would let the layout back-compute a cell width from a pane that no
     * longer exists, which is the same class of defect one level up.
     */
    expect(useTerminalStatusStore.getState().fittedWidth).toBe(0)
  })

  it('does not notify subscribers when nothing changed', () => {
    useTerminalStatusStore.getState().publish(snapshot)
    const before = useTerminalStatusStore.getState().active
    useTerminalStatusStore.getState().publish({ ...snapshot })
    // Identity, not deep equality: a new object would re-render every subscriber.
    expect(useTerminalStatusStore.getState().active).toBe(before)
  })

  it('records a changed fitted width even when the size did not move', () => {
    /*
     * A font-size change alters the cell width while `cols`/`rows` can stay identical
     * for one frame. If `fittedWidth` were not part of the comparison, the layout would
     * keep deciding against the old cell width.
     */
    useTerminalStatusStore.getState().publish(snapshot)
    useTerminalStatusStore.getState().publish({ ...snapshot, fittedWidth: 1024 * 0.9 })
    expect(useTerminalStatusStore.getState().fittedWidth).toBeCloseTo(1024 * 0.9, 5)
  })

  it('tolerates a publish with no measured width', () => {
    const { fittedWidth: _omitted, ...withoutWidth } = snapshot
    useTerminalStatusStore.getState().publish(withoutWidth)
    expect(useTerminalStatusStore.getState().fittedWidth).toBe(0)
    expect(useTerminalStatusStore.getState().active?.cols).toBe(120)
  })
})
