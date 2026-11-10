// Phase 10.4 WP-B — clearing a stored credential, distinct from deleting the host.
//
// `updateHost` has accepted `clearCredential: true` since Phase 10.1 and is covered
// by service tests. Nothing in the UI ever sets it: a search for the flag outside
// tests finds only the type declaration and the consumer in `hosts.ts`. So a user
// who wants to stop storing a password — switching to agent auth, handing the host
// to a colleague, or recovering from a credential they believe is compromised —
// has no way to do it short of deleting the host and losing its groups, tags and
// favourites.
//
// The entry has to be visually distinct from delete: one is reversible (save a new
// credential), the other is not.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import i18n from '@/locales'
import { HostDialog } from './host-dialog'

const mocks = vi.hoisted(() => ({
  updateHost: vi.fn(),
  addHost: vi.fn(),
  deleteHost: vi.fn(),
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

vi.mock('@/hooks/use-breakpoint', () => ({ useIsMobile: () => false }))

const hostWithCredential = {
  id: 'h-1',
  name: 'prod',
  hostname: 'prod.test',
  port: 22,
  username: 'deploy',
  authType: 'password',
  credentialRef: { kinds: ['password'], provider: 'vault', version: 2 },
  isFavorite: true,
  groupId: 'g-1',
  tags: ['prod'],
  portForwards: [],
  agentForwarding: false,
  shellIntegration: 'off',
  createdAt: 0,
  updatedAt: 0,
} as unknown as Host

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  mocks.updateHost.mockResolvedValue(undefined)
})

describe('clearing a stored credential', () => {
  it('offers a clear action for a host that stores one', () => {
    render(<HostDialog open host={hostWithCredential} onClose={vi.fn()} />)
    expect(screen.getByTestId('host-clear-credential')).toBeTruthy()
  })

  it('does not offer it when nothing is stored', () => {
    render(
      <HostDialog
        open
        host={{ ...hostWithCredential, credentialRef: null } as unknown as Host}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('host-clear-credential')).toBeNull()
  })

  it('asks before clearing, and says what changes', async () => {
    render(<HostDialog open host={hostWithCredential} onClose={vi.fn()} />)

    fireEvent.click(screen.getByTestId('host-clear-credential'))
    // A confirmation, not an immediate destructive action.
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    expect(mocks.updateHost).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /clear|confirm|清除/i }))
    await waitFor(() => expect(mocks.updateHost).toHaveBeenCalled())

    const [id, payload] = mocks.updateHost.mock.calls[0] as [string, Host]
    expect(id).toBe('h-1')
    // The service-layer contract the UI is required to actually reach.
    expect((payload as { clearCredential?: boolean }).clearCredential).toBe(true)
  })

  it('keeps the host and its non-secret settings', async () => {
    render(<HostDialog open host={hostWithCredential} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('host-clear-credential'))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /clear|confirm|清除/i }))

    await waitFor(() => expect(mocks.updateHost).toHaveBeenCalled())
    const [, payload] = mocks.updateHost.mock.calls[0] as [string, Host]
    // Deleting is a different action with a different button; this one must not
    // touch the row's identity or its grouping.
    expect(mocks.deleteHost).not.toHaveBeenCalled()
    expect((payload as { name?: string }).name ?? 'prod').toBe('prod')
  })

  it('is a different control from delete', () => {
    render(<HostDialog open host={hostWithCredential} onClose={vi.fn()} />)
    const clear = screen.getByTestId('host-clear-credential')
    const remove = screen.queryByTestId('host-delete')
    if (remove !== null) expect(clear).not.toBe(remove)
  })
})
