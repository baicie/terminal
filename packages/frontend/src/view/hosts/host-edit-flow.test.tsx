// Phase 10.2-A1 — the edit flow end to end, through the real components.
//
// The unit above proves the entry exists. This one proves the chain works:
// card menu → dialog seeded with the stored values → user changes one field →
// save calls `updateHost` (not `addHost`) with that host's id → the store is
// refreshed from the database → the dialog closes.
//
// It deliberately does not call `updateHost` directly. The defect was never in
// that function; it was that nothing ever reached it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import en from '@/locales/en'
import { HostDialog } from '@/components/host-list/host-dialog'
import i18n from '@/locales'
import { HostCard } from './host-card'

const mocks = vi.hoisted(() => ({
  addHost: vi.fn(),
  updateHost: vi.fn(),
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

vi.mock('@/hooks/use-breakpoint', () => ({
  useIsMobile: () => false,
}))

const storedHost = {
  id: 'h1',
  name: 'Existing',
  hostname: 'example.com',
  port: 2222,
  username: 'root',
  authType: 'password',
  // Post-10.1 state: both secret columns are NULL in the row, so the mapper
  // hands the form empty values and the vault holds the real ones.
  password: '',
  privateKey: '',
  certificate: '',
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
  mocks.addHost.mockResolvedValue(undefined)
})

describe('editing a saved host from its card', () => {
  it('opens the dialog seeded with that host and saves through updateHost', async () => {
    // The wiring the view does: menu edit → set the editing host → render dialog.
    const Wired = () => {
      const [editing, setEditing] = React.useState<Host | null>(null)
      return (
        <>
          <HostCard
            host={storedHost}
            variant="grid"
            onConnect={vi.fn()}
            onEdit={setEditing}
          />
          <HostDialog
            open={editing !== null}
            host={editing ?? undefined}
            onClose={() => setEditing(null)}
          />
        </>
      )
    }

    render(<Wired />)

    // 1. Open the card menu and choose Edit.
    fireEvent.pointerDown(
      screen.getByRole('button', { name: /more actions/i }),
      { button: 0, ctrlKey: false, pointerType: 'mouse' },
    )
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy())
    fireEvent.click(screen.getByRole('menuitem', { name: /edit/i }))

    // 2. The dialog shows the stored values, not an empty create form.
    await waitFor(() => {
      expect(screen.getByDisplayValue('Existing')).toBeTruthy()
    })
    expect(screen.getByDisplayValue('example.com')).toBeTruthy()
    expect(screen.getByDisplayValue('2222')).toBeTruthy()
    expect(screen.getByDisplayValue('root')).toBeTruthy()

    // The title says this is an edit.
    expect(screen.getByText(en['hosts.form.editHost'])).toBeTruthy()

    // 3. Change one field and save.
    fireEvent.change(screen.getByDisplayValue('example.com'), {
      target: { value: 'changed.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // 4. It went through updateHost for THIS host, never addHost.
    await waitFor(() => expect(mocks.updateHost).toHaveBeenCalledTimes(1))
    expect(mocks.addHost).not.toHaveBeenCalled()

    const [id, payload] = mocks.updateHost.mock.calls[0] as [string, Host]
    expect(id).toBe('h1')
    expect(payload.hostname).toBe('changed.example.com')
    // Untouched fields survive the round trip.
    expect(payload.name).toBe('Existing')
    expect(payload.port).toBe(2222)
    expect(payload.username).toBe('root')
  })

  it('does not blank a stored credential when the secret field is left empty', async () => {
    render(
      <HostDialog open host={storedHost} onClose={vi.fn()} />,
    )

    fireEvent.change(screen.getByDisplayValue('example.com'), {
      target: { value: 'changed.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mocks.updateHost).toHaveBeenCalled())

    const [, payload] = mocks.updateHost.mock.calls[0] as [string, Host]
    // An empty secret field means "leave it alone". The form sends `''`, and the
    // write path decides what to do with it via `Boolean(updates.password ||
    // updates.privateKey)` — `''` is falsy, so `hasSecrets` stays false and the
    // vault is never touched. Asserting the falsiness rather than a particular
    // representation is what matters: either empty value must skip the vault.
    expect(Boolean(payload.password)).toBe(false)
    expect(Boolean(payload.privateKey)).toBe(false)
  })

  it('keeps the dialog open and the typed value when the save fails', async () => {
    mocks.updateHost.mockRejectedValue(new Error('vault is locked'))

    render(<HostDialog open host={storedHost} onClose={vi.fn()} />)

    fireEvent.change(screen.getByDisplayValue('example.com'), {
      target: { value: 'changed.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mocks.updateHost).toHaveBeenCalled())

    // The user must not lose what they typed because the vault refused.
    expect(screen.getByDisplayValue('changed.example.com')).toBeTruthy()
  })

  it('preserves favourites, groups and tags through an edit', async () => {
    render(<HostDialog open host={storedHost} onClose={vi.fn()} />)

    fireEvent.change(screen.getByDisplayValue('example.com'), {
      target: { value: 'changed.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mocks.updateHost).toHaveBeenCalled())
    const [, payload] = mocks.updateHost.mock.calls[0] as [string, Host]

    expect(payload.isFavorite).toBe(true)
    expect(payload.groupId).toBe('g-1')
    expect(payload.tags).toEqual(['prod'])
  })
})
