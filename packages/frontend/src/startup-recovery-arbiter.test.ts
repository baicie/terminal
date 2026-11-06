import { describe, expect, it } from 'vitest'
import {
  decideStartupFallback,
  type StartupRecoverySnapshot,
} from './startup-recovery-arbiter'

const base: StartupRecoverySnapshot = {
  deadlineElapsed: true,
  deferBudgetElapsed: false,
  recoveryActive: false,
  retryScheduled: false,
  layoutState: 'unknown',
  usableTerminal: false,
  fallbackOpened: false,
}

const decide = (overrides: Partial<StartupRecoverySnapshot>) =>
  decideStartupFallback({ ...base, ...overrides })

describe('startup recovery arbiter', () => {
  it('never creates a fallback before the deadline', () => {
    expect(decide({ deadlineElapsed: false, layoutState: 'absent' })).toEqual({
      action: 'defer',
      reason: 'deadline-pending',
    })
  })

  it('does not let a local fallback steal a layout that is still being read', () => {
    expect(decide({ recoveryActive: true, layoutState: 'pending' })).toEqual({
      action: 'defer',
      reason: 'recovery-active',
    })
  })

  it('does not create while a bounded retry is pending', () => {
    expect(decide({ retryScheduled: true, layoutState: 'failed' })).toEqual({
      action: 'defer',
      reason: 'retry-scheduled',
    })
  })

  it('waits on a pending layout even when recovery has just settled', () => {
    expect(decide({ layoutState: 'pending' })).toEqual({
      action: 'defer',
      reason: 'layout-pending',
    })
  })

  it('creates only after a definite absence', () => {
    expect(decide({ layoutState: 'absent' })).toEqual({
      action: 'create',
      reason: 'layout-absent',
    })
  })

  it('creates when a definite absence is known while recovery closes out', () => {
    expect(decide({ layoutState: 'absent', recoveryActive: true })).toEqual({
      action: 'create',
      reason: 'layout-absent',
    })
  })

  it('creates after retries are exhausted', () => {
    expect(decide({ layoutState: 'failed' })).toEqual({
      action: 'create',
      reason: 'layout-failed',
    })
  })

  it('suppresses when a usable terminal exists', () => {
    expect(decide({ usableTerminal: true, layoutState: 'known' })).toEqual({
      action: 'suppress',
      reason: 'usable-terminal',
    })
  })

  it('is idempotent once the fallback is open', () => {
    expect(decide({ fallbackOpened: true, usableTerminal: true })).toEqual({
      action: 'suppress',
      reason: 'fallback-already-open',
    })
  })

  it('opens a safety terminal when the bounded defer budget expires', () => {
    expect(
      decide({
        deferBudgetElapsed: true,
        recoveryActive: true,
        layoutState: 'pending',
      }),
    ).toEqual({ action: 'create', reason: 'defer-budget-expired' })
  })

  it('opens a safety terminal when a known layout leaves no usable tab', () => {
    expect(decide({ layoutState: 'known' })).toEqual({
      action: 'create',
      reason: 'layout-known-without-terminal',
    })
  })

  it('opens a fallback when recovery never produced an observation', () => {
    expect(decide({ layoutState: 'unknown' })).toEqual({
      action: 'create',
      reason: 'no-recovery',
    })
  })

  it('covers the F-round shape: layout known late, no local takeover', () => {
    const duringRecovery = decide({
      recoveryActive: true,
      layoutState: 'known',
      deadlineElapsed: true,
    })
    expect(duringRecovery.action).toBe('defer')

    const afterRestore = decide({
      recoveryActive: false,
      layoutState: 'known',
      usableTerminal: true,
    })
    expect(afterRestore.action).toBe('suppress')
  })
})
