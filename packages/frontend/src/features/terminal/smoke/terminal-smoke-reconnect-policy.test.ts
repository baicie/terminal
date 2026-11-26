// F13 — the policy probe must reject what it cannot interpret, not normalise it away.
//
// The value crosses IPC and becomes the attempt count of a real ladder. A silent fallback
// to the defaults here would make an injected run pass while proving nothing: the harness
// would report success for a policy the product never walked.

import { describe, expect, it, vi } from 'vitest'

import { loadTerminalSmokeReconnectPolicy } from './terminal-smoke-reconnect-policy'

const ipcReturning = (value: unknown) => ({
  invoke: vi.fn(async () => value),
})

describe('loading the injected reconnect policy', () => {
  it('is absent when the harness injected nothing', async () => {
    // The common case: an ordinary smoke run. Naming it keeps a caller from treating
    // `null` as "apply an empty policy", which would reset a previous one.
    await expect(
      loadTerminalSmokeReconnectPolicy(ipcReturning(null)),
    ).resolves.toBeNull()
  })

  it('carries the fields the harness set', async () => {
    await expect(
      loadTerminalSmokeReconnectPolicy(
        ipcReturning({ baseDelayMs: 200, maxAttempts: 2 }),
      ),
    ).resolves.toEqual({ baseDelayMs: 200, maxAttempts: 2 })
  })

  it('leaves an unset field out rather than defaulting it', async () => {
    /*
     * A scenario that names only `maxAttempts` wants the product's own backoff. Filling in
     * a delay here would mean the harness quietly chose a number the scenario never asked
     * for, and the run would then measure that number.
     */
    await expect(
      loadTerminalSmokeReconnectPolicy(ipcReturning({ maxAttempts: 3 })),
    ).resolves.toEqual({ maxAttempts: 3 })
  })

  it('rejects a zero or negative attempt count', async () => {
    // Zero means "one attempt, never retry" to the ladder — a different scenario.
    for (const value of [0, -1]) {
      await expect(
        loadTerminalSmokeReconnectPolicy(ipcReturning({ maxAttempts: value })),
      ).rejects.toThrow('Invalid terminal smoke reconnect policy')
    }
  })

  it('rejects a fractional or non-numeric value', async () => {
    for (const value of [1.5, Number.NaN, '2', {}]) {
      await expect(
        loadTerminalSmokeReconnectPolicy(ipcReturning({ maxAttempts: value })),
      ).rejects.toThrow('Invalid terminal smoke reconnect policy')
    }
  })

  it('rejects a payload that is not an object', async () => {
    await expect(
      loadTerminalSmokeReconnectPolicy(ipcReturning('maxAttempts=2')),
    ).rejects.toThrow('Invalid terminal smoke reconnect policy')
  })
})
