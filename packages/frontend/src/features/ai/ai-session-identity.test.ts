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

describe('a reconnect invalidates an approval', () => {
  it('rejects when the backend session changed under the same tab', () => {
    // The defect this now guards: same tab, new backend session. Before
    // `backendSessionId` existed the approval still matched, and the text being sent
    // could belong to a different host.
    publishTerminalSessionId('tab-1', 'ssh-session-1')
    const approved = context({ sessionId: 'tab-1', backendSessionId: 'ssh-session-1' })

    expect(contextMatchesSession(approved, 'tab-1', 'ssh-session-1')).toBe(true)
    expect(
      contextMatchesSession(approved, 'tab-1', 'ssh-session-2'),
      'a reconnect must invalidate the approval even though the tab id did not move',
    ).toBe(false)
  })

  it('rejects when the session is gone', () => {
    const approved = context({ sessionId: 'tab-1', backendSessionId: 'ssh-session-1' })
    expect(contextMatchesSession(approved, 'tab-1', null)).toBe(false)
  })

  it('still accepts a context that recorded no backend session', () => {
    // A local terminal has a tab and no backend session. Refusing it would break the
    // case where there is no remote host to be wrong about.
    const approved = context({ sessionId: 'tab-1', backendSessionId: null })
    expect(contextMatchesSession(approved, 'tab-1', null)).toBe(true)
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
