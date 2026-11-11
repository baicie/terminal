// Phase 10.4.1 WP3 — the pane must choose its vault action from the kind.
//
// Phase 10.4 added a `credentialKind` to the classifier, to the record and to the
// snapshot. None of it reached the screen: `TerminalPaneHeader` still called
// `vaultActionFor(props.errorMessage)`, matching English sentences. So the header
// could disagree with the classifier — most visibly, a vault that "could not be
// read" was mapped to "Unlock the vault", sending the user to unlock a vault whose
// problem unlocking does not fix.
//
// This file holds the mapping to structure. It renders the real header with a
// `credentialKind` and asserts what a user would see, and it asserts that a
// message which merely *looks* like a vault problem produces nothing.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Host, Tab } from '@/types'
import { TerminalPaneHeader } from './terminal-pane-header'

const navigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const strings: Record<string, string> = {
        'common.retry': 'Retry',
        'terminal.clear': 'Clear',
        'terminal.search': 'Find',
        'terminal.showTools': 'Show tools',
        'terminal.fullscreen': 'Fullscreen',
        'terminal.status.connected': 'Connected',
        'terminal.status.reconnecting': 'Reconnecting',
        'terminal.status.error': 'Error',
        'terminal.status.retryExhausted': 'Waiting to retry',
        'terminal.retryExhaustedHint': 'Automatic retries resume later.',
        'terminal.disconnect': 'Disconnect',
        'terminal.vault.create': 'Create a vault',
        'terminal.vault.unlock': 'Unlock the vault',
        'terminal.vault.manage': 'Open Vaults',
        // Deliberately distinct labels so the test can tell them apart.
        'terminal.vault.rebind': 'Re-save the credential',
      }
      return strings[key] ?? key
    },
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const tab: Tab = {
  id: 'terminal-one',
  label: 'Production',
  type: 'remote',
  hostId: 'host-one',
}

const host: Host = {
  id: 'host-one',
  name: 'Production',
  hostname: 'prod.example.com',
  port: 22,
  username: 'deploy',
  authType: 'password',
  isFavorite: false,
  portForwards: [],
  createdAt: 1,
  updatedAt: 1,
}

function renderHeader(overrides: Record<string, unknown>) {
  return render(
    <TooltipProvider>
      <TerminalPaneHeader
        tab={tab}
        host={host}
        status="error"
        fontSize={14}
        isMobile={false}
        toolsOpen={false}
        fullscreen={false}
        onSearch={vi.fn()}
        onClear={vi.fn()}
        onToggleTools={vi.fn()}
        onFontSizeChange={vi.fn()}
        onResetFontSize={vi.fn()}
        onToggleFullscreen={vi.fn()}
        onRequestFocus={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  )
}

function actionText(): string | null {
  const node = screen.queryByTestId('terminal-vault-action')
  return node === null ? null : (node.textContent ?? null)
}

describe('the vault action follows the structured kind', () => {
  it('a locked vault offers unlocking', () => {
    renderHeader({
      credentialKind: 'vault-locked',
      errorMessage: 'This host stores its credentials in the vault, which is locked.',
    })
    expect(actionText()).toBe('Unlock the vault')
  })

  it('an uninitialized vault offers creating one', () => {
    renderHeader({
      credentialKind: 'vault-uninitialized',
      errorMessage: 'no vault has been set up yet',
    })
    expect(actionText()).toBe('Create a vault')
  })

  it('an unusable vault offers the vaults page, not unlocking', () => {
    // The Phase 10.4 bug: "could not be read" was mapped to unlock. Unlocking a
    // vault that cannot be read is not the fix, and the sentence the user needs
    // is "go look at it".
    renderHeader({
      credentialKind: 'vault-unusable',
      errorMessage: 'This host stores its credentials in the vault, but the vault could not be read.',
    })
    expect(actionText()).toBe('Open Vaults')
  })

  it('a failed decrypt offers the vaults page', () => {
    renderHeader({
      credentialKind: 'credential-read-failed',
      errorMessage: 'Reading the stored password for this host failed.',
    })
    expect(actionText()).toBe('Open Vaults')
  })

  it('a damaged reference offers re-saving the credential', () => {
    renderHeader({
      credentialKind: 'credential-corrupt-reference',
      errorMessage: 'This host has a stored credential this build cannot read.',
    })
    expect(actionText()).toBe('Re-save the credential')
  })

  it('an unbound imported key offers re-saving the credential', () => {
    renderHeader({
      credentialKind: 'credential-not-bound',
      errorMessage: 'This host was imported with the key file ~/.ssh/id_ed25519, which has not been bound yet.',
    })
    expect(actionText()).toBe('Re-save the credential')
  })

  it('a credential with no stored entry offers re-saving the credential', () => {
    renderHeader({
      credentialKind: 'credential-missing',
      errorMessage: 'the vault holds none',
    })
    expect(actionText()).toBe('Re-save the credential')
  })
})

describe('the message is not the decision', () => {
  it('a network error whose text mentions the vault shows nothing', () => {
    // The inverse of the text match: the sentence says "which is locked", and
    // without a kind that used to be enough to render an action. It must not be.
    renderHeader({
      errorMessage:
        'This host stores its credentials in the vault, which is locked. Unlock the vault and connect again.',
    })
    expect(screen.queryByTestId('terminal-vault-action')).toBeNull()
  })

  it('an ordinary network error shows nothing', () => {
    renderHeader({ errorMessage: 'connection reset by peer' })
    expect(screen.queryByTestId('terminal-vault-action')).toBeNull()
  })

  it('a connected session shows nothing even if a kind leaked through', () => {
    // A stale kind on a healthy session would offer "Unlock the vault" on a
    // working connection. The header is the last line of defence.
    renderHeader({ status: 'connected', credentialKind: 'vault-locked' })
    expect(screen.queryByTestId('terminal-vault-action')).toBeNull()
  })

  it('a reconnect in progress shows nothing', () => {
    renderHeader({ status: 'reconnecting', credentialKind: 'vault-locked' })
    expect(screen.queryByTestId('terminal-vault-action')).toBeNull()
  })
})

describe('the action actually navigates', () => {
  it('points at a route the app has', () => {
    // The app uses `createBrowserRouter` (history API), not a hash router, so an
    // `href="#/vaults"` changes only the fragment: nothing routes, and the click
    // silently does nothing.
    renderHeader({ credentialKind: 'vault-locked' })
    expect(
      screen.getByTestId('terminal-vault-action').getAttribute('href'),
    ).toBe('/vaults')
  })

  it('routes in-app instead of reloading the webview', () => {
    // A plain `<a href>` would perform a document navigation, reloading the
    // webview and tearing down every live terminal session — including the one
    // whose header this is. The click is handled by the router instead.
    navigate.mockClear()
    renderHeader({ credentialKind: 'vault-locked' })
    const link = screen.getByTestId('terminal-vault-action')

    fireEvent.click(link)

    expect(navigate).toHaveBeenCalledWith('/vaults')
  })

  it('sends a damaged reference to the host, where it can be re-saved', () => {
    navigate.mockClear()
    renderHeader({ credentialKind: 'credential-corrupt-reference' })
    const link = screen.getByTestId('terminal-vault-action')

    fireEvent.click(link)

    expect(navigate).toHaveBeenCalledWith('/hosts')
  })

  it('leaves a modified click to the browser', () => {
    // Cmd/Ctrl-click means "open in a new window"; intercepting it would take a
    // choice away from the user. jsdom cannot follow the navigation and logs
    // "Not implemented: navigation to another Document" — which is the proof
    // that the anchor is a real link and the plain click above is the one being
    // intercepted, not a no-op element dressed as one.
    navigate.mockClear()
    renderHeader({ credentialKind: 'vault-locked' })

    fireEvent.click(screen.getByTestId('terminal-vault-action'), {
      metaKey: true,
    })

    expect(navigate).not.toHaveBeenCalled()
  })
})
