import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import en from '@/locales/en'
import { HostDialog } from './host-dialog'

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

const host = {
  id: 'h1',
  name: 'Existing',
  hostname: 'example.com',
  port: 22,
  username: 'root',
  authType: 'password',
  password: '',
  privateKey: '',
  certificate: '',
  isFavorite: false,
  tags: [],
  portForwards: [],
  agentForwarding: false,
  shellIntegration: 'off',
  createdAt: 0,
  updatedAt: 0,
} as unknown as Host

beforeEach(() => {
  vi.clearAllMocks()
})

describe('host dialog dismissal', () => {
  it('closes immediately when nothing was edited', () => {
    const onClose = vi.fn()
    render(<HostDialog open host={host} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('asks before discarding unsaved edits', () => {
    const onClose = vi.fn()
    render(<HostDialog open host={host} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText(en['hosts.form.name']), {
      target: { value: 'Edited' },
    })
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(en['hosts.form.discardTitle'])).toBeTruthy()

    fireEvent.click(screen.getByText(en['hosts.form.keepEditing']))
    expect(screen.queryByText(en['hosts.form.discardTitle'])).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByText(en['hosts.form.discard']))
    expect(onClose).toHaveBeenCalled()
  })
})
