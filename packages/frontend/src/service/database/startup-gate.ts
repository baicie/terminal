/**
 * Process-wide database startup gate.
 *
 * The recovery decision must not live in a component's render path: React runs
 * effects for hooks declared before an early return, so a conditional screen is
 * not a gate. The bootstrap mounts StartupGate first; only an explicit allow
 * opens this module, and getDb() refuses to open the database until then.
 *
 * `unset` is for non-UI entry points (unit tests, tooling) that never run the
 * gate. Once the gate begins, only `allowed` may reach SQLite.
 */
export type StartupGateState = 'unset' | 'pending' | 'allowed' | 'blocked'

let state: StartupGateState = 'unset'

export function beginStartupGate(): void {
  state = 'pending'
}

export function allowStartup(): void {
  state = 'allowed'
}

export function blockStartup(): void {
  state = 'blocked'
}

export function currentStartupGate(): StartupGateState {
  return state
}

export function assertDatabaseAllowed(): void {
  if (state === 'pending' || state === 'blocked') {
    throw new Error(
      'database access is blocked until the recovery startup gate allows it',
    )
  }
}

/** Test-only reset; production code never returns to `unset`. */
export function resetStartupGateForTests(): void {
  state = 'unset'
}
