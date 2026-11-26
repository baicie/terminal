/**
 * The automatic reconnect ladder, extracted from the class that owns it.
 *
 * ## Why it is its own file
 *
 * `TerminalSessionReconnect` was already at its 300-line limit before F13 added policy
 * replacement, and the ladder loop plus its three end paths is the largest coherent block
 * in it. Keeping the loop here is a move, not a rewrite: every branch, comment and wait
 * is the one that ran before.
 *
 * ## What the caller still owns
 *
 * The ladder decides *when* to try and *how long* to wait; the manager decides *what
 * trying means* (`start`), *who is still allowed to write* (`isActive`), and how the pane
 * is reset between rungs (`prepareIo`). Passing those in keeps the loop a pure scheduler —
 * a property the F13 tests exercise by handing it a policy whose `sleep` they control.
 */

import { formatIpcError } from '@/hooks/terminal-session-helpers'
import { closeTerminalBackend } from './terminal-session-backend'
import { reconnectDelayFor } from './terminal-session-reconnect-policy'
import { recordTerminalConnectionFailure } from './terminal-connection-failure-log'
import {
  updateTerminalState,
  terminalFailureState,
} from './terminal-session-state'
import type { TerminalFailure } from './terminal-session-manager-errors'
import type { TerminalRecord } from './terminal-session-manager-types'
import type { ResolvedReconnectPolicy } from './terminal-reconnect-policy-holder'
import type { TerminalReconnectStartResult } from './terminal-session-reconnect-types'

export interface TerminalReconnectLadderDependencies {
  /** Run one connection attempt; the manager decides what that means. */
  start: (
    record: TerminalRecord,
    generation: number,
    signal: AbortSignal,
  ) => Promise<TerminalReconnectStartResult>
  /** Whether this ladder still owns the record (not closed, not superseded). */
  isActive: (record: TerminalRecord, generation: number) => boolean
  /** Reset the pane's io/record between rungs. */
  prepareIo: (record: TerminalRecord) => void
  /** The backend session to close before the first retry, if the first attempt made one. */
  initialSessionId: string | null
  /** Arms the recovery timer that opens the next ladder after a backoff. */
  armRecovery: (policy: ResolvedReconnectPolicy) => void
}

/**
 * Walk the ladder to completion, a connection, or a failure that must leave it.
 *
 * Returns when the record is connected, cancelled, superseded, or has published a
 * terminal verdict. It never throws: every failure it can see is a state it writes.
 */
export async function runReconnectLadder(args: {
  record: TerminalRecord
  mode: NonNullable<TerminalRecord['reconnectMode']>
  reason: string
  signal: AbortSignal
  generation: number
  policy: ResolvedReconnectPolicy
  dependencies: TerminalReconnectLadderDependencies
}): Promise<void> {
  const { record, mode, reason, signal, generation, policy, dependencies } = args
  const attempts = mode === 'automatic' ? policy.maxAttempts : 1
  /*
   * F06 — the ladder remembers the last *failure*, not just its sentence.
   *
   * Keeping only a string dropped the hop/stage/diagnosis the classifier had attached, so
   * an exhausted jump connection published "authentication rejected" without saying which
   * of the two logins was refused. The whole failure is replaced on every attempt, never
   * merged: a later failure that carries no hop must clear an older one instead of
   * inheriting a claim about a machine this attempt never touched.
   */
  let lastFailure: TerminalFailure = {
    error: reason,
    retryable: true,
    recovery: 'automatic',
  }

  let attempt = 0
  while (attempt < attempts) {
    attempt += 1
    if (attempt > 1) dependencies.prepareIo(record)
    const delay = mode === 'automatic' ? reconnectDelayFor(policy, attempt) : 0
    updateTerminalState(record, {
      status: 'reconnecting',
      sessionId: null,
      error: null,
      attempt,
      reason: lastFailure.error,
      nextRetryAt: mode === 'automatic' ? policy.now() + delay : undefined,
      retryable: true,
      // This loop is the automatic ladder, so the record says so while it
      // runs. Without it the record would carry `null` and a host wake could
      // not tell an in-progress network recovery from a vault failure.
      recovery: 'automatic',
    })
    if (attempt === 1 && dependencies.initialSessionId) {
      await closeTerminalBackend(record.request.tabType, dependencies.initialSessionId)
    }
    if (!dependencies.isActive(record, generation)) return

    if (mode === 'automatic') {
      try {
        await policy.sleep(delay, signal)
      } catch (error) {
        if (signal.aborted || !dependencies.isActive(record, generation)) return
        if (dependencies.isActive(record, generation)) {
          updateTerminalState(record, {
            status: 'error',
            error: formatIpcError(error),
            retryable: true,
            recovery: 'automatic',
          })
          dependencies.armRecovery(policy)
        }
        return
      }
    }
    if (!dependencies.isActive(record, generation)) return

    const result = await dependencies.start(record, generation, signal)
    if (result === 'connected' || result === 'cancelled') return
    if (result.status === 'retry') {
      /*
       * A host wake can arrive while this reconnect loop is waiting on an in-flight SSH
       * handshake. Restart the same loop with a fresh budget; launching another reconnect
       * here would be rejected by the Promise guard and leave the pane stuck in
       * `reconnecting`.
       *
       * F06 — the whole failure travels with the restart. It used to be the message alone,
       * which is how a wake during a bastion failure could end up publishing a
       * context-free verdict.
       */
      lastFailure = result.failure
      attempt = 0
      dependencies.prepareIo(record)
      continue
    }
    lastFailure = {
      error: result.error,
      retryable: result.retryable,
      recovery: result.recovery,
      ...(result.credentialKind !== undefined
        ? { credentialKind: result.credentialKind }
        : {}),
      ...(result.hop !== undefined ? { hop: result.hop } : {}),
      ...(result.stage !== undefined ? { stage: result.stage } : {}),
      ...(result.diagnosis !== undefined ? { diagnosis: result.diagnosis } : {}),
    }
    if (result.recovery !== 'automatic') {
      /*
       * The retry loop is itself the automatic ladder. A failure that needs the vault
       * fixed, or a person to change something, must leave the loop rather than run out
       * its remaining attempts against the same cause. Writing the verdict through
       * `updateTerminalState` also carries the credential kind to the pane.
       */
      updateTerminalState(record, {
        status: 'error',
        sessionId: null,
        ...terminalFailureState(lastFailure),
        attempt,
      })
      return
    }
  }
  if (!dependencies.isActive(record, generation)) return
  // F06 — exhausted: describe the *last* attempt, never whichever one carried a hop.
  // `recovery` stays `'automatic'`; a recovery timer may still open another ladder.
  updateTerminalState(record, {
    status: 'error',
    sessionId: null,
    ...terminalFailureState(lastFailure),
    // F10 — "the attempt that ended", republished by the snapshot as `attempts`.
    attempt,
  })
  // F18 — the ladder's verdict is a finished connection; the start path's terminal
  // branch does not record, so exactly one of the two runs per logical connection.
  recordTerminalConnectionFailure(record.request, lastFailure)
  dependencies.armRecovery(policy)
}
