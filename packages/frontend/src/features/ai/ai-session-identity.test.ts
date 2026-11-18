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
import { buildContext, contextMatchesSession } from './context-review'
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

describe('the approval actually records the backend session', () => {
  // The guard in `contextMatchesSession` is only worth anything if a real context
  // carries the id. It did not: `backendSessionId` was published and compared, but
  // `buildContext` never accepted it, so every production context had `undefined`
  // and the comparison was skipped — a mechanism with nothing driving it.
  it('buildContext copies the backend session onto the context it returns', () => {
    const built = buildContext({
      kind: 'selection',
      hostId: 'h-1',
      sessionId: 'tab-1',
      backendSessionId: 'ssh-session-1',
      text: 'kubectl get pods',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) throw new Error('unreachable')
    expect(
      built.context.backendSessionId,
      'a context built for a real session must record it, or the reconnect guard never runs',
    ).toBe('ssh-session-1')
  })

  it('a reconnect invalidates a context that came through buildContext', () => {
    // End to end through the builder rather than a hand-built literal: this is the
    // shape the dock actually produces.
    const built = buildContext({
      kind: 'selection',
      hostId: 'h-1',
      sessionId: 'tab-1',
      backendSessionId: 'ssh-session-1',
      text: 'kubectl get pods',
      approved: true,
    })
    if (!built.ok) throw new Error('unreachable')
    expect(contextMatchesSession(built.context, 'tab-1', 'ssh-session-1')).toBe(true)
    expect(contextMatchesSession(built.context, 'tab-1', 'ssh-session-2')).toBe(false)
  })

  it('a local terminal context still passes, with no backend session to compare', () => {
    const built = buildContext({
      kind: 'selection',
      hostId: null,
      sessionId: 'tab-1',
      text: 'echo hi',
      approved: true,
    })
    if (!built.ok) throw new Error('unreachable')
    expect(built.context.backendSessionId).toBeNull()
    expect(contextMatchesSession(built.context, 'tab-1', null)).toBe(true)
  })
})
