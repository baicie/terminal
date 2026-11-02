import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import i18n from '@/locales'
import { toast } from '@/components/ui/sonner'
import { HostCardActions, HostDeleteConfirm } from './hosts-card-actions'

const deleteHost = vi.hoisted(() => vi.fn())

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

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
  port: 22,
  username: 'deploy',
} as unknown as Host

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
})

describe('HostCardActions', () => {
  it('gives the icon-only more-actions trigger an accessible name', () => {
    render(
      <HostCardActions
        host={host}
        showTeamActions={false}
        onCopySsh={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'More actions for web-1' }),
    ).toBeTruthy()
  })

  it('only requests deletion from the menu, never deleting by itself', async () => {
    const onRequestDelete = vi.fn()
    render(
      <HostCardActions
        host={host}
        showTeamActions={false}
        onCopySsh={vi.fn()}
        onRequestDelete={onRequestDelete}
      />,
    )

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'More actions for web-1' }),
      { button: 0, ctrlKey: false },
    )
    const deleteItem = await screen.findByTestId('host-card-delete')
    fireEvent.click(deleteItem)

    expect(onRequestDelete).toHaveBeenCalledTimes(1)
    expect(deleteHost).not.toHaveBeenCalled()
  })

  it('opens the destructive confirmation from the menu before any delete', async () => {
    deleteHost.mockResolvedValue(undefined)
    const Wired = () => {
      const [open, setOpen] = useState(false)
      return (
        <div className="relative group">
          <HostCardActions
            host={host}
            showTeamActions={false}
            onCopySsh={vi.fn()}
            onRequestDelete={() => setOpen(true)}
          />
          <HostDeleteConfirm host={host} open={open} onOpenChange={setOpen} />
        </div>
      )
    }
    render(<Wired />)

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'More actions for web-1' }),
      { button: 0, ctrlKey: false },
    )
    fireEvent.click(await screen.findByTestId('host-card-delete'))

    expect(await screen.findByText('Delete Host')).toBeTruthy()
    expect(deleteHost).not.toHaveBeenCalled()
  })
})

describe('HostDeleteConfirm', () => {
  it('states the consequences and deletes only after confirmation', async () => {
    deleteHost.mockResolvedValue(undefined)
    render(<HostDeleteConfirm host={host} open onOpenChange={vi.fn()} />)

    expect(deleteHost).not.toHaveBeenCalled()
    expect(
      screen.getByText(/group membership and favourite flag are removed/),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteHost).toHaveBeenCalledWith('h-1'))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Host "web-1" deleted'),
    )
  })

  it('surfaces the storage error instead of reporting a successful delete', async () => {
    deleteHost.mockRejectedValue(new Error('database is locked'))
    render(<HostDeleteConfirm host={host} open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to delete host: database is locked',
      ),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })
})
