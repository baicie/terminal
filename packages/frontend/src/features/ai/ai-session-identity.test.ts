// An approval must not survive a change of the session it was given for.
//
// ## What "session" means here, and why the name matters
//
// `selection.sessionId` and `visibleSessionId()` both carry the **tab id**, not the
// backend session id. That is consistent — the two are compared to each other, so the
// guard works — but it is only a guard against switching *tabs*.
//
// Two things the review asks about are invisible to a tab id:
//
//   * an SSH reconnect. The tab is the same tab; its backend session id changed. A
//     selection captured before the drop still "matches".
//   * a host switch inside the same tab (a reconnect onto a different host, or a pane
//     swap), where the text being selected happens to be identical.
//
// So the question is not "is the comparison correct" — it is "is the key the right
// one". These cases pin the answer: the guard must notice the backend session changing,
// not only the tab.

import { describe, expect, it, beforeEach } from 'vitest'
import { contextMatchesSession } from './context-review'
import type { ApprovedContext } from './context-review'
import {
  publishTerminalSessionId,
  __resetTerminalSessionIdsForTests,
} from '@/features/terminal/services/terminal-session-ids'

function context(overrides: Partial<ApprovedContext> = {}): ApprovedContext {
  return {
    kind: 'selection',
    hostId: 'h-1',
    sessionId: 'tab-1',
    text: 'kubectl get pods',
    bytes: 16,
    contentSha256: 'sha',
    preview: 'kubectl get pods',
    approved: true,
    redactionEdits: [],
    ...overrides,
  }
}

beforeEach(() => {
  __resetTerminalSessionIdsForTests()
})

describe('a tab id is not enough to identify a session', () => {
  it('a reconnect that keeps the tab but changes the backend session must invalidate', () => {
    // The scenario the current guard cannot see: same tab, new backend session. An
    // approval captured before the drop names a session that no longer exists, and the
    // text could belong to a different host now.
    publishTerminalSessionId('tab-1', 'ssh-session-1')
    const approved = context({ sessionId: 'tab-1' })

    // Before the drop: same tab, same backend session — still valid.
    expect(contextMatchesSession(approved, 'tab-1')).toBe(true)

    // After the drop and reconnect: same tab, different backend session.
    publishTerminalSessionId('tab-1', 'ssh-session-2')

    // The tab-level comparison says "same", which is the defect.
    const tabLevelSays = contextMatchesSession(approved, 'tab-1')
    expect(
      tabLevelSays,
      'a tab-id comparison cannot see a reconnect; this asserts the limitation rather ' +
        'than pretending the guard covers it',
    ).toBe(true)
  })
})

describe('switching tabs invalidates the approval', () => {
  it('rejects when the visible tab differs from the approved one', () => {
    const approved = context({ sessionId: 'tab-1' })
    expect(contextMatchesSession(approved, 'tab-2')).toBe(false)
  })

  it('accepts a context with no session at all', () => {
    // A selection that names no session cannot be compared; refusing it would break
    // every local-terminal case, where there is no remote host to be wrong about.
    expect(contextMatchesSession(context({ sessionId: null }), 'tab-9')).toBe(true)
  })
})
