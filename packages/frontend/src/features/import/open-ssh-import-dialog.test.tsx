// Phase 10.2-B1 — the wizard's behaviour, driven through the real component.
//
// What matters here is not that a dropdown exists but that the flow is honest:
// nothing is written before confirmation, duplicates start unselected, an entry
// the parser warned about stays visible, and a per-entry failure is reported per
// entry rather than swallowed.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import { OpenSshImportDialog } from './open-ssh-import-dialog'

const mocks = vi.hoisted(() => ({
  addHost: vi.fn(),
  readTextFile: vi.fn(),
}))

const state = {
  hosts: [] as Array<Record<string, unknown>>,
  addHost: mocks.addHost,
}

vi.mock('@/store/host', () => ({
  useHostStore: (selector?: (value: typeof state) => unknown) =>
    selector ? selector(state) : state,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => '/tmp/config'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: mocks.readTextFile,
}))

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => '/Users/tester'),
}))

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const CONFIG = `Host web
  HostName web.example.test
  User deploy
  Port 2222

Host db
  HostName db.internal
  User admin
`

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  state.hosts = []
  mocks.readTextFile.mockResolvedValue(CONFIG)
  mocks.addHost.mockResolvedValue(undefined)
})

async function openAndPick() {
  render(<OpenSshImportDialog open onOpenChange={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /choose a config file/i }))
  await waitFor(() => expect(screen.getByTestId('import-row-web')).toBeTruthy())
}

describe('the wizard previews before it writes', () => {
  it('lists every parsed host and writes nothing until confirm', async () => {
    await openAndPick()

    expect(screen.getByTestId('import-row-web')).toBeTruthy()
    expect(screen.getByTestId('import-row-db')).toBeTruthy()

    // The heart of it: previewing must not create anything.
    expect(mocks.addHost).not.toHaveBeenCalled()
  })

  it('creates the selected hosts on confirm', async () => {
    await openAndPick()
    fireEvent.click(screen.getByRole('button', { name: /^import 2$/i }))

    await waitFor(() => expect(mocks.addHost).toHaveBeenCalledTimes(2))
    const names = mocks.addHost.mock.calls.map(
      ([row]) => (row as { name: string }).name,
    )
    expect(names.sort()).toEqual(['db', 'web'])
  })

  it('starts a duplicate unselected and never creates it', async () => {
    state.hosts = [
      {
        id: 'existing',
        name: 'web',
        hostname: 'web.example.test',
        port: 2222,
        username: 'deploy',
      },
    ]
    await openAndPick()

    const row = screen.getByTestId('import-row-web')
    expect(row.textContent).toMatch(/already saved/i)

    // Only the new host counts toward the confirm button.
    fireEvent.click(screen.getByRole('button', { name: /^import 1$/i }))
    await waitFor(() => expect(mocks.addHost).toHaveBeenCalledTimes(1))
    expect((mocks.addHost.mock.calls[0][0] as { name: string }).name).toBe('db')
  })

  it('reports one failing host without hiding the ones that worked', async () => {
    mocks.addHost
      .mockRejectedValueOnce(new Error('vault is locked'))
      .mockResolvedValueOnce(undefined)

    await openAndPick()
    fireEvent.click(screen.getByRole('button', { name: /^import 2$/i }))

    await waitFor(() => {
      expect(screen.getByText(/1 host\(s\) imported/i)).toBeTruthy()
    })
    // The failure is named, not swallowed.
    expect(screen.getByText(/vault is locked/)).toBeTruthy()
  })

  it('shows parser warnings above the list', async () => {
    mocks.readTextFile.mockResolvedValue(`Host *
  User x

Host real
  HostName real.example.test
`)
    render(<OpenSshImportDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /choose a config file/i }))

    await waitFor(() => expect(screen.getByTestId('import-row-real')).toBeTruthy())

    expect(screen.getByText(/warning/i)).toBeTruthy()
    // The wildcard is called out, not silently dropped.
    expect(screen.getByText(/pattern/i)).toBeTruthy()
  })

  it('offers pasting as an alternative to picking a file', async () => {
    render(<OpenSshImportDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /paste the config/i }))

    const area = screen.getByLabelText(/ssh config text/i)
    fireEvent.change(area, { target: { value: CONFIG } })
    fireEvent.click(screen.getByRole('button', { name: /read this text/i }))

    await waitFor(() => expect(screen.getByTestId('import-row-web')).toBeTruthy())
    expect(mocks.readTextFile).not.toHaveBeenCalled()
  })

  it('refuses a config with no hosts and says why', async () => {
    mocks.readTextFile.mockResolvedValue('# just a comment\n')
    render(<OpenSshImportDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /choose a config file/i }))

    await waitFor(() => {
      expect(screen.getByText(/no hosts were found/i)).toBeTruthy()
    })
    expect(mocks.addHost).not.toHaveBeenCalled()
  })
})
