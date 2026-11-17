// The Inspector must be given the backend session id, not the tab id.
//
// ## The defect this pins
//
// `RightPanel` passed `activeTab.id` as the Inspector's `sessionId`. The tab id is a
// frontend identifier: the session manager keys its records by it and the backend
// never sees it. `session_exec` takes the *backend* session id, the one
// `session_create_*` returned.
//
// So the Inspector asked `session_exec` for a session that does not exist. In a real
// app that is a failed exec, which the panel reports as a probe error — the metrics
// never arrive, and nothing in the message says the id was the wrong *kind* of id.
//
// ## Why this is a test and not a comment
//
// The component tests all passed, because they hand the component whatever session id
// the test chooses. Only the wiring is wrong, and wiring is what this covers: two ids
// that are both strings, both non-empty, and only one of which means anything to the
// backend.

import { describe, expect, it } from 'vitest'
import {
  publishTerminalSessionId,
  sessionIdForTab,
  subscribeTerminalSessionIds,
  __resetTerminalSessionIdsForTests,
} from './terminal-session-ids'

describe('the backend session id is tracked per tab', () => {
  it('returns the published backend session id, not the tab id', () => {
    __resetTerminalSessionIdsForTests()
    // The two ids differ, which is the whole point: a test that used one value for
    // both would pass against the defect.
    publishTerminalSessionId('tab-1', 'ssh-session-1')
    expect(sessionIdForTab('tab-1')).toBe('ssh-session-1')
    expect(sessionIdForTab('tab-1')).not.toBe('tab-1')
  })

  it('returns null for a tab that never connected', () => {
    // A tab exists before its session does. Returning the tab id as a fallback is
    // exactly the defect: it is non-empty, so nothing downstream can tell it is
    // wrong.
    __resetTerminalSessionIdsForTests()
    expect(sessionIdForTab('tab-1')).toBeNull()
  })

  it('clears the id when the session goes away', () => {
    // A disconnected tab keeps its tab id forever. If the map kept the old backend id,
    // the Inspector would probe a session the backend has already dropped — the same
    // class of "exec against something that is not there".
    __resetTerminalSessionIdsForTests()
    publishTerminalSessionId('tab-1', 'ssh-session-1')
    publishTerminalSessionId('tab-1', null)
    expect(sessionIdForTab('tab-1')).toBeNull()
  })

  it('replaces the id on reconnect rather than keeping the first', () => {
    // A reconnect produces a new backend session id. Keeping the old one would point
    // the Inspector at a dead session.
    __resetTerminalSessionIdsForTests()
    publishTerminalSessionId('tab-1', 'ssh-session-1')
    publishTerminalSessionId('tab-1', 'ssh-session-2')
    expect(sessionIdForTab('tab-1')).toBe('ssh-session-2')
  })

  it('keeps two tabs apart', () => {
    __resetTerminalSessionIdsForTests()
    publishTerminalSessionId('tab-1', 'ssh-a')
    publishTerminalSessionId('tab-2', 'ssh-b')
    expect(sessionIdForTab('tab-1')).toBe('ssh-a')
    expect(sessionIdForTab('tab-2')).toBe('ssh-b')
  })

  it('notifies subscribers so a panel can re-read after a reconnect', () => {
    // The Inspector has to notice a new session id: it is disabled while there is
    // none, and a reconnect after a drop must re-enable it without a manual refresh.
    __resetTerminalSessionIdsForTests()
    const seen: Array<string | null> = []
    const unsubscribe = subscribeTerminalSessionIds(() => seen.push(sessionIdForTab('tab-1')))
    publishTerminalSessionId('tab-1', 'ssh-session-1')
    publishTerminalSessionId('tab-1', null)
    unsubscribe()
    publishTerminalSessionId('tab-1', 'ssh-session-3')
    expect(seen).toEqual(['ssh-session-1', null])
  })
})
