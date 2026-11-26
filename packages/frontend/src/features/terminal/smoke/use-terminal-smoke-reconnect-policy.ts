// F13 — apply the reconnect policy the harness asked for.
//
// ## Why this is not a render gate
//
// The first version held the smoke root's render until the policy finished loading, so a
// round could not start on the defaults. That broke the lifecycle tests, and the reason is
// worth keeping: `useTerminalSmokeOrchestrator` starts waiting for its resource baseline the
// moment it mounts, and in a test environment there is no IPC to answer the policy call —
// the gate never opened and no round ever rendered. Measured: two `terminal-smoke-lifecycle`
// cases went red with "expected vi.fn() to be called at least once".
//
// Blocking the whole UI on a value that is usually absent is the wrong shape regardless of
// tests: an ordinary run has no policy at all, and it should not wait a round-trip to learn
// that. So the policy is applied as soon as it arrives, and **the first round waits for it
// where the round itself starts** — which is the only place where ordering actually matters.
//
// ## Why both modules are imported lazily
//
// `terminal-smoke-imports.test.ts` forbids the smoke root from evaluating, at module-load
// time, the IPC contract module and the database graph, and this hook needs both. Top-level
// imports failed that test twice (measured: "terminal smoke evaluated the IPC contract
// module", then the same for the manager).

import { useEffect, useState } from 'react'

export type TerminalSmokeReconnectPolicyState =
  | { status: 'pending' }
  | { status: 'ready' }
  | { status: 'failed'; error: Error }

export interface TerminalSmokeReconnectPolicyResult {
  state: TerminalSmokeReconnectPolicyState
  /**
   * Resolves when the policy has settled, one way or the other.
   *
   * A stable promise, created once — the orchestrator holds it in an effect dependency, and
   * a fresh promise per render would restart that effect (and its baseline wait) forever.
   * It resolves even on failure: a failed policy is rendered to the operator, not waited on.
   */
  ready: Promise<void>
}

/**
 * Load and apply the policy once, reporting when it has settled.
 *
 * A failed load is `failed` rather than a thrown error: the caller renders it next to the
 * round, so a scenario that asked for two attempts and could not get them is visible instead
 * of silently running on the defaults.
 */
export function useTerminalSmokeReconnectPolicy(): TerminalSmokeReconnectPolicyResult {
  const [state, setState] = useState<TerminalSmokeReconnectPolicyState>({
    status: 'pending',
  })
  /*
   * Created once, outside the render path's identity churn. `useState`'s initialiser runs
   * on the first render only, which is exactly the lifetime wanted here.
   */
  const [settled] = useState(() => {
    let resolveReady!: () => void
    const ready = new Promise<void>(resolve => {
      resolveReady = resolve
    })
    return { ready, resolveReady }
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { loadTerminalSmokeReconnectPolicy } = await import(
        './terminal-smoke-reconnect-policy'
      )
      const policy = await loadTerminalSmokeReconnectPolicy()
      if (cancelled) return
      if (policy !== null) {
        const { terminalSessionManager } = await import(
          '@/features/terminal/services/terminal-session-manager'
        )
        if (cancelled) return
        terminalSessionManager.setReconnectPolicy(policy)
      }
      setState({ status: 'ready' })
    })()
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })
      .finally(() => {
        settled.resolveReady()
      })
    return () => {
      cancelled = true
    }
  }, [settled])

  return { state, ready: settled.ready }
}
