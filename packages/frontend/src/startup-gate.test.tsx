import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isValidRecoveryStatus,
  startupAllowed,
  type DbRecoveryStatus,
} from './service/database/recovery-status'
import {
  allowStartup,
  assertDatabaseAllowed,
  beginStartupGate,
  blockStartup,
  resetStartupGateForTests,
} from './service/database/startup-gate'

const probe = vi.fn()

vi.mock('./service/database/recovery-status', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    './service/database/recovery-status',
  )
  return {
    ...actual,
    probeRecoveryStatus: (...args: unknown[]) => probe(...args),
  }
})

vi.mock('./App', () => ({
  default: () => <div data-testid="business-app" />,
}))

import StartupGate from './startup-gate'

function recovery(state: DbRecoveryStatus['state']): DbRecoveryStatus {
  return {
    state,
    reason: `${state} reason`,
    restoredFrom: null,
    stages: [],
    markerCleared: false,
  }
}

function allowed(state: DbRecoveryStatus['state']) {
  probe.mockResolvedValue({ ok: true, status: recovery(state) })
}

describe('startup gate policy', () => {
  it('allows only HEALTHY and RECOVERED', () => {
    expect(startupAllowed(recovery('HEALTHY'))).toBe(true)
    expect(startupAllowed(recovery('RECOVERED'))).toBe(true)
    for (const state of [
      'RECOVERY_REQUIRED',
      'BACKUP_VALIDATING',
      'RESTORING',
      'RESTORE_INTERRUPTED',
      'MANUAL_INTERVENTION_REQUIRED',
    ] as const) {
      expect(startupAllowed(recovery(state))).toBe(false)
    }
  })

  it('rejects malformed status payloads', () => {
    expect(isValidRecoveryStatus(null)).toBe(false)
    expect(isValidRecoveryStatus({ state: 'HEALTHY' })).toBe(false)
    expect(isValidRecoveryStatus({ state: 'NOPE', reason: '', stages: [] })).toBe(false)
    expect(isValidRecoveryStatus(recovery('HEALTHY'))).toBe(true)
  })

  it('blocks database access while the gate is pending or blocked', () => {
    resetStartupGateForTests()
    expect(() => assertDatabaseAllowed()).not.toThrow()
    beginStartupGate()
    expect(() => assertDatabaseAllowed()).toThrow(/blocked/)
    blockStartup()
    expect(() => assertDatabaseAllowed()).toThrow(/blocked/)
    allowStartup()
    expect(() => assertDatabaseAllowed()).not.toThrow()
  })
})

describe('StartupGate', () => {
  beforeEach(() => {
    probe.mockReset()
    resetStartupGateForTests()
  })

  it.each([
    'RECOVERY_REQUIRED',
    'BACKUP_VALIDATING',
    'RESTORING',
    'RESTORE_INTERRUPTED',
    'MANUAL_INTERVENTION_REQUIRED',
  ] as const)('never mounts business effects while %s', async state => {
    allowed(state)
    render(<StartupGate />)
    expect(await screen.findByText('Retry recovery')).toBeTruthy()
    expect(screen.queryByTestId('business-app')).toBeNull()
  })

  it.each(['HEALTHY', 'RECOVERED'] as const)('mounts business app on %s', async state => {
    allowed(state)
    render(<StartupGate />)
    expect(await screen.findByTestId('business-app')).toBeTruthy()
  })

  it('fails closed when the Tauri status call fails', async () => {
    probe.mockResolvedValue({ ok: false, nonTauri: false, reason: 'timeout' })
    render(<StartupGate />)
    expect(await screen.findByText('Retry recovery')).toBeTruthy()
    expect(screen.queryByTestId('business-app')).toBeNull()
  })

  it('allows the explicit non-Tauri browser branch', async () => {
    probe.mockResolvedValue({ ok: false, nonTauri: true, reason: 'browser' })
    render(<StartupGate />)
    expect(await screen.findByTestId('business-app')).toBeTruthy()
  })

  it('re-enters the gate on retry and mounts only after an allow', async () => {
    probe
      .mockResolvedValueOnce({
        ok: true,
        status: recovery('MANUAL_INTERVENTION_REQUIRED'),
      })
      .mockResolvedValueOnce({ ok: true, status: recovery('RECOVERED') })
    render(<StartupGate />)
    const retry = await screen.findByText('Retry recovery')
    fireEvent.click(retry)
    expect(await screen.findByTestId('business-app')).toBeTruthy()
    expect(probe).toHaveBeenLastCalledWith({ retry: true })
  })

  it('survives StrictMode double effects without mounting twice', async () => {
    allowed('HEALTHY')
    render(
      <StrictMode>
        <StartupGate />
      </StrictMode>,
    )
    await waitFor(() => expect(screen.getAllByTestId('business-app')).toHaveLength(1))
  })
})
