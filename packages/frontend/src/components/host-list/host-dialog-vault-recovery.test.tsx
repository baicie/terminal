// Phase 10.2-A2 — a refused save must offer the next step, not just name it.
//
// `vaultUnavailableMessage` already distinguishes `uninitialized` from `locked`
// and says what to do. But it arrives as a toast, and the dialog closes over it:
// the text says "create a vault on the Vaults page", which sends the user away
// from the form they were filling in, and the form is gone when they come back.
//
// The requirement: when a save is refused because the vault cannot take the
// secret, the dialog stays open, keeps what was typed, and offers the action
// itself — create or unlock — without a second trip to another page.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import { HostDialog } from '@/components/host-list/host-dialog'
import i18n from '@/locales'

const mocks = vi.hoisted(() => ({
  addHost: vi.fn(),
  updateHost: vi.fn(),
  deleteHost: vi.fn(),
  availability: vi.fn(),
  create: vi.fn(),
  unlock: vi.fn(),
}))

const state = {
  hosts: [] as Host[],
  groups: [],
  addHost: mocks.addHost,
  updateHost: mocks.updateHost,
  deleteHost: mocks.deleteHost,
  selectedHostId: null,
}

vi.mock('@/store/host', () => ({
  useHostStore: (selector?: (value: typeof state) => unknown) =>
    selector ? selector(state) : state,
}))

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/hooks/use-breakpoint', () => ({
  useIsMobile: () => false,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    availability: mocks.availability,
  },
}))

vi.mock('@/service/vault', () => ({
  vaultService: {
    create: mocks.create,
    unlock: mocks.unlock,
  },
}))


beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  mocks.availability.mockResolvedValue({ ok: true })
})

/** Fill the minimum fields and type a password, then save. */
async function submitWithPassword() {
  fireEvent.change(screen.getByLabelText(/^name$/i), {
    target: { value: 'fresh' },
  })
  fireEvent.change(screen.getByLabelText(/hostname/i), {
    target: { value: 'fresh.example.test' },
  })
  fireEvent.change(screen.getByLabelText(/username/i), {
    target: { value: 'root' },
  })
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'hunter2' },
  })
  fireEvent.click(screen.getByRole('button', { name: /save/i }))
  await waitFor(() => expect(mocks.addHost).toHaveBeenCalled())
}

describe('a save refused by the vault offers the next step in place', () => {
  it('offers to create a vault when none exists yet', async () => {
    mocks.addHost.mockRejectedValue(
      new Error(
        'This has a password or private key, but no vault has been set up yet.',
      ),
    )
    mocks.availability.mockResolvedValue({ ok: false, state: 'uninitialized' })

    render(<HostDialog open host={undefined} onClose={vi.fn()} />)
    await submitWithPassword()

    await waitFor(() => {
      // The dialog is still here, and it now carries a way forward.
      expect(screen.getByTestId('vault-recovery')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /create.*vault/i })).toBeTruthy()
    // The typed value is still there.
    expect(screen.getByDisplayValue('hunter2')).toBeTruthy()
  })

  it('offers to unlock when the vault exists but is locked', async () => {
    mocks.addHost.mockRejectedValue(
      new Error('This has a password or private key, but the vault is locked.'),
    )
    mocks.availability.mockResolvedValue({ ok: false, state: 'locked' })

    render(<HostDialog open host={undefined} onClose={vi.fn()} />)
    await submitWithPassword()

    await waitFor(() => {
      expect(screen.getByTestId('vault-recovery')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /unlock/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /create.*vault/i })).toBeNull()
  })

  it('does not claim a fix when the vault is unreadable', async () => {
    mocks.addHost.mockRejectedValue(
      new Error('This has a password or private key, but the vault could not be read.'),
    )
    mocks.availability.mockResolvedValue({ ok: false, state: 'unusable' })

    render(<HostDialog open host={undefined} onClose={vi.fn()} />)
    await submitWithPassword()

    await waitFor(() => {
      expect(screen.getByTestId('vault-recovery')).toBeTruthy()
    })
    // "Unusable" has no in-place fix, so the UI must not pretend otherwise.
    expect(screen.queryByRole('button', { name: /unlock/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /create.*vault/i })).toBeNull()
  })

  it('a non-vault failure does not show the vault recovery panel', async () => {
    mocks.addHost.mockRejectedValue(new Error('database is locked'))

    render(<HostDialog open host={undefined} onClose={vi.fn()} />)
    await submitWithPassword()

    await waitFor(() => expect(mocks.addHost).toHaveBeenCalled())
    // A database error is not a vault problem; showing "create a vault" here
    // would send the user to fix the wrong thing.
    expect(screen.queryByTestId('vault-recovery')).toBeNull()
  })

  it('creating a vault from the dialog retries the same save', async () => {
    mocks.addHost
      .mockRejectedValueOnce(
        new Error('This has a password or private key, but no vault has been set up yet.'),
      )
      .mockResolvedValueOnce(undefined)
    mocks.availability
      .mockResolvedValueOnce({ ok: false, state: 'uninitialized' })
      .mockResolvedValue({ ok: true })
    mocks.create.mockResolvedValue(undefined)

    render(<HostDialog open host={undefined} onClose={vi.fn()} />)
    await submitWithPassword()
    await waitFor(() => expect(screen.getByTestId('vault-recovery')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /create.*vault/i }))
    const passwordField = await screen.findByTestId('vault-recovery-password')
    fireEvent.change(passwordField, { target: { value: 'master-pass' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('master-pass'))
    // The save is retried without the user re-typing the host password.
    await waitFor(() => expect(mocks.addHost).toHaveBeenCalledTimes(2))
  })
})
