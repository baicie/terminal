/**
 * Startup recovery / local-fallback arbitration.
 *
 * The local fallback used to be decided by `tabs.length === 0` at a fixed
 * deadline. That cannot distinguish "no saved layout" from "the saved layout
 * has not been read yet", so a slow or transiently failing recovery let a local
 * PTY take over a restorable remote tab (Issue #184).
 *
 * This module keeps the decision pure: callers feed in what recovery currently
 * knows, and the arbiter returns suppress / defer / create with a reason. The
 * React hook owns timers and tracing; the state machine stays testable without
 * fake IPC or fake databases.
 */

export type StartupLayoutState =
  | 'unknown'
  | 'pending'
  | 'known'
  | 'absent'
  | 'failed'

export interface StartupRecoverySnapshot {
  /** The fallback deadline has been reached (it may already have passed). */
  deadlineElapsed: boolean
  /** Bounded grace after the deadline has also elapsed. */
  deferBudgetElapsed: boolean
  /** A recovery attempt is currently in flight. */
  recoveryActive: boolean
  /** A bounded retry has been scheduled but has not started yet. */
  retryScheduled: boolean
  layoutState: StartupLayoutState
  /** Any tab that can host a terminal (local, or remote with a host id). */
  usableTerminal: boolean
  /** A startup fallback has already been added in this app run. */
  fallbackOpened: boolean
}

export type FallbackDecisionAction = 'suppress' | 'defer' | 'create'

export type FallbackDecisionReason =
  | 'fallback-already-open'
  | 'usable-terminal'
  | 'deadline-pending'
  | 'defer-budget-expired'
  | 'recovery-active'
  | 'retry-scheduled'
  | 'layout-pending'
  | 'layout-absent'
  | 'layout-failed'
  | 'layout-known-without-terminal'
  | 'no-recovery'

export interface FallbackDecision {
  action: FallbackDecisionAction
  reason: FallbackDecisionReason
}

/**
 * Decision order matters:
 *
 * 1. A usable terminal always wins; never add a second one.
 * 2. Before the deadline, never create.
 * 3. The bounded defer budget is a safety valve: once it expires, create even
 *    if recovery still claims to be active, so a hung query cannot leave the
 *    user without a terminal.
 * 4. A definite "absent" creates immediately; there is nothing to restore.
 * 5. While recovery is active / retrying / still reading the layout, defer.
 *    This is what prevents a local PTY from stealing a remote layout that is
 *    about to be restored.
 * 6. A definite "failed" (after retries) or a known layout with no usable tab
 *    creates a fallback as a safety net.
 */
export function decideStartupFallback(
  snapshot: StartupRecoverySnapshot,
): FallbackDecision {
  if (snapshot.fallbackOpened) {
    return { action: 'suppress', reason: 'fallback-already-open' }
  }
  if (snapshot.usableTerminal) {
    return { action: 'suppress', reason: 'usable-terminal' }
  }
  if (!snapshot.deadlineElapsed) {
    return { action: 'defer', reason: 'deadline-pending' }
  }
  if (snapshot.deferBudgetElapsed) {
    return { action: 'create', reason: 'defer-budget-expired' }
  }
  if (snapshot.layoutState === 'absent') {
    // The database and the crash journal both said "no layout". Nothing is
    // left to restore, even if the recovery attempt is still closing out.
    return { action: 'create', reason: 'layout-absent' }
  }
  if (snapshot.recoveryActive) {
    return { action: 'defer', reason: 'recovery-active' }
  }
  if (snapshot.retryScheduled) {
    return { action: 'defer', reason: 'retry-scheduled' }
  }
  if (snapshot.layoutState === 'pending') {
    return { action: 'defer', reason: 'layout-pending' }
  }
  if (snapshot.layoutState === 'failed') {
    return { action: 'create', reason: 'layout-failed' }
  }
  if (snapshot.layoutState === 'known') {
    // Recovery finished and restored/kept tabs, yet none is usable (for
    // example every saved remote tab lost its host). A local terminal is
    // better than an empty window; the saved layout is already preserved.
    return { action: 'create', reason: 'layout-known-without-terminal' }
  }
  return { action: 'create', reason: 'no-recovery' }
}
