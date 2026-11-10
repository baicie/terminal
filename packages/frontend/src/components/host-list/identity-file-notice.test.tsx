// Phase 10.3 WP1 — the imported host must tell the user what it needs.
//
// A host whose ssh config named an IdentityFile looks configured: hostname, user,
// auth type all present. It is not connectable, and nothing in the dialog said so.
// The user's only clue was a connect-time error mentioning a path they never chose
// inside this app.

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import i18n from '@/locales'
import { HostDialog } from './host-dialog'

vi.mock('@/store/host', () => {
  const state = {
    hosts: [],
    groups: [],
    addHost: vi.fn(async () => undefined),
    updateHost: vi.fn(async () => undefined),
    deleteHost: vi.fn(async () => undefined),
    selectedHostId: null,
  }
  return {
    useHostStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  }
})

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/hooks/use-breakpoint', () => ({
  useIsMobile: () => false,
}))

const importedHost = {
  id: 'imported-1',
  name: 'db',
  hostname: 'db.internal',
  port: 22,
  username: 'deploy',
  authType: 'key',
  identityFilePath: '~/.ssh/id_ed25519',
  isFavorite: false,
  tags: [],
  portForwards: [],
  agentForwarding: false,
  shellIntegration: 'off',
  createdAt: 0,
  updatedAt: 0,
} as unknown as Host

const plainHost = {
  ...importedHost,
  id: 'plain-1',
  name: 'plain',
  identityFilePath: undefined,
} as unknown as Host

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
})

describe('an imported host explains the key file it expects', () => {
  it('shows the path the config named', () => {
    render(<HostDialog open host={importedHost} onClose={vi.fn()} />)

    const notice = screen.getByTestId('identity-file-notice')
    expect(notice.textContent).toContain('~/.ssh/id_ed25519')
  })

  it('says the app will not read the file on its own', () => {
    render(<HostDialog open host={importedHost} onClose={vi.fn()} />)
    expect(screen.getByTestId('identity-file-notice').textContent).toMatch(
      /does not read files|不会在连接时自行读取/i,
    )
  })

  it('offers the one action that resolves it', () => {
    render(<HostDialog open host={importedHost} onClose={vi.fn()} />)
    const action = screen.getByTestId('identity-file-bind-key')
    // The key field already exists in the form; this points at it rather than
    // opening a second flow.
    expect(document.getElementById('privateKey')).not.toBeNull()
    fireEvent.click(action)
    expect(document.getElementById('privateKey')).not.toBeNull()
  })

  it('does not appear for a host with no imported path', () => {
    render(<HostDialog open host={plainHost} onClose={vi.fn()} />)
    expect(screen.queryByTestId('identity-file-notice')).toBeNull()
  })
})
