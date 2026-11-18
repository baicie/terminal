// Switching tabs must reach the runner, not just the reducer.
//
// `AiRunner.sessionChanged` was a mechanism whose only caller in the whole repository
// was a test: the reducer handled `session-changed`, and nothing ever sent it. An
// answer computed for the host the user was looking at could land after they moved to
// another tab, and the dock would render it against the new one.
//
// This renders the real hook against the real store so the wiring itself is observed —
// a unit test on `sessionChanged` would pass on the broken version too.
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store/app'

vi.mock('@/service/database/ai-profiles', () => ({
  listModelProfiles: vi.fn(async () => []),
}))

import { __resetAiRunnerForTests, useAiRuntime } from './use-ai-runtime'

/** Mounts the hook and hands the runner back to the test. */
function mountRuntime() {
  let runner: ReturnType<typeof useAiRuntime>['runner'] | null = null
  function Probe() {
    const runtime = useAiRuntime()
    runner = runtime.runner
    return null
  }
  render(<Probe />)
  if (!runner) throw new Error('the hook did not return a runner')
  return runner
}

describe('the runner is told when the visible tab changes', () => {
  beforeEach(() => {
    __resetAiRunnerForTests()
    useAppStore.setState({ tabs: [], splitGroups: [], activeTabId: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends session-changed on mount and on every tab change', () => {
    const runner = mountRuntime()
    const spy = vi.spyOn(runner, 'sessionChanged')

    act(() => {
      useAppStore.setState({
        tabs: [{ id: 'tab-a', label: 'A', type: 'local' }],
        activeTabId: 'tab-a',
      })
    })
    expect(
      spy,
      'switching tabs must reach the runner, or an in-flight answer lands under the wrong session',
    ).toHaveBeenCalledWith('tab-a')

    act(() => {
      useAppStore.setState({
        tabs: [
          { id: 'tab-a', label: 'A', type: 'local' },
          { id: 'tab-b', label: 'B', type: 'local' },
        ],
        activeTabId: 'tab-b',
      })
    })
    expect(spy).toHaveBeenLastCalledWith('tab-b')

    act(() => {
      useAppStore.setState({ activeTabId: null })
    })
    expect(spy).toHaveBeenLastCalledWith(null)
  })

  it('does not fire again when an unrelated store field changes', () => {
    // A runner told "the session changed" on every store write would mark results
    // stale continuously. Only the tab identity matters.
    const runner = mountRuntime()
    act(() => {
      useAppStore.setState({
        tabs: [{ id: 'tab-a', label: 'A', type: 'local' }],
        activeTabId: 'tab-a',
      })
    })
    const spy = vi.spyOn(runner, 'sessionChanged')
    act(() => {
      useAppStore.setState({ sidebarVisible: !useAppStore.getState().sidebarVisible })
    })
    expect(spy).not.toHaveBeenCalled()
  })
})
