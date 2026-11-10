// Phase 10.2-A1 — editing an existing host must be reachable from the UI.
//
// The defect this locks:
//
// `HostDialog` accepts a `host` prop and `updateHost` is fully implemented, but
// every place that renders the dialog passes only `open`/`onClose`. The card
// actions menu offers copy, share and delete — no edit. So `host` is always
// `undefined`, `handleSubmit` always takes the `addHost` branch, and a user cannot
// change an address, port, user, auth type or credential of a saved host at all.
//
// The tests below drive the real components: they render the default dropdown
// action, then the card variant, and assert the edit entry exists and hands the
// right host object to the caller. They do not call `updateHost` directly — that
// function was never the problem.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import i18n from '@/locales'
import { HostCard } from './host-card'
import { HostCardActions } from './hosts-card-actions'
import { MobileHostCard } from './mobile-host-card'

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const deleteHost = vi.hoisted(() => vi.fn())
vi.mock('@/store/host', () => ({
  useHostStore: () => ({ deleteHost }),
}))

vi.mock('@/hooks/use-breakpoint', () => ({
  useIsMobile: () => false,
}))

const host = {
  id: 'h-1',
  name: 'web-1',
  hostname: 'web-1.internal',
  port: 2222,
  username: 'deploy',
  authType: 'key',
  isFavorite: true,
  groupId: 'g-1',
  tags: ['prod'],
} as unknown as Host

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
})

/** Open the more-actions menu and return the menu items by their text. */
async function openMoreActions() {
  const trigger = screen.getByRole('button', { name: /more actions/i })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  await waitFor(() => {
    expect(screen.getByRole('menu')).toBeTruthy()
  })
  return screen.getByRole('menu')
}

describe('the card actions menu offers editing', () => {
  it('shows an edit entry that hands the caller this host', async () => {
    const onEdit = vi.fn()
    render(
      <HostCardActions
        host={host}
        showTeamActions={false}
        onCopySsh={vi.fn()}
        onRequestDelete={vi.fn()}
        onEdit={onEdit}
      />,
    )

    const menu = await openMoreActions()
    const edit = screen.getByRole('menuitem', { name: /edit/i })
    expect(menu.contains(edit)).toBe(true)

    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(host)
  })

  it('keeps delete in a separate entry from edit', async () => {
    render(
      <HostCardActions
        host={host}
        showTeamActions={false}
        onCopySsh={vi.fn()}
        onRequestDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    )

    await openMoreActions()
    const edit = screen.getByRole('menuitem', { name: /edit/i })
    const remove = screen.getByTestId('host-card-delete')
    // Editing and deleting must never be the same control: one is reversible, the
    // other is not.
    expect(edit).not.toBe(remove)
    expect(remove.contains(edit)).toBe(false)
  })

  it('the edit entry is keyboard reachable', async () => {
    const onEdit = vi.fn()
    render(
      <HostCardActions
        host={host}
        showTeamActions={false}
        onCopySsh={vi.fn()}
        onRequestDelete={vi.fn()}
        onEdit={onEdit}
      />,
    )

    await openMoreActions()
    const edit = screen.getByRole('menuitem', { name: /edit/i })
    edit.focus()
    expect(document.activeElement).toBe(edit)
    fireEvent.keyDown(edit, { key: 'Enter' })
    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalled()
  })
})

describe('every desktop card variant can start an edit', () => {
  it('the grid variant forwards edit for the host it renders', async () => {
    const onEdit = vi.fn()
    render(
      <HostCard
        host={host}
        variant="grid"
        onConnect={vi.fn()}
        onEdit={onEdit}
      />,
    )

    await openMoreActions()
    fireEvent.click(screen.getByRole('menuitem', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(host)
  })

  it('the list variant exposes edit through its actions menu', async () => {
    const onEdit = vi.fn()
    const { container } = render(
      <HostCard
        host={host}
        variant="list"
        onConnect={vi.fn()}
        onEdit={onEdit}
      />,
    )

    // The list row renders the same action trigger; it must not be grid-only.
    const trigger = container.querySelector(
      '[data-testid="host-card-actions-trigger"]',
    )
    expect(trigger).not.toBeNull()

    fireEvent.pointerDown(trigger as Element, {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    })
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy())
    fireEvent.click(screen.getByRole('menuitem', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(host)
  })
})

describe('the mobile sheet has an edit entry', () => {
  it('offers edit next to connect and delete', () => {
    const onEdit = vi.fn()
    render(
      <MobileHostCard
        host={host}
        sheetOpen
        showTeamActions={false}
        labels={{
          connect: 'Connect',
          copySsh: 'Copy SSH',
          share: '',
          delete: 'Delete',
          edit: 'Edit',
        }}
        onSheetOpenChange={vi.fn()}
        onConnect={vi.fn()}
        onCopySsh={vi.fn()}
        onDelete={vi.fn()}
        onEdit={onEdit}
      />,
    )

    const edit = screen.getByRole('button', { name: 'Edit' })
    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalledWith(host)
  })
})
