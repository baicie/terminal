// Phase 10.5 — a failed connection has to stay on screen.
//
// The only place a connection error appeared was a toast:
// `use-terminal-status-effects.ts` fires `toast.error(...)` and sonner removes it
// after a few seconds. The terminal area itself is an empty xterm, and the vault
// action is a small link on the right of the header. A user whose connection was
// refused sees a message flash in the corner and then a blank pane with no
// explanation and nothing to click.
//
// Observed on a real build: "Test1 连接失败时 只有右下角一个提示 一会就没了".
//
// A toast is the wrong surface for this. The error is the state of the pane, not
// a passing notification about it, and the fix the user needs (unlock the vault,
// re-save the credential) has to be reachable from where the error is.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Host, Tab } from '@/types'
import { TerminalErrorOverlay } from './terminal-error-overlay'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const strings: Record<string, string> = {
        'terminal.errorTitle': 'Terminal error',
        'common.retry': 'Retry',
        'terminal.vault.create': 'Create a vault',
        'terminal.vault.unlock': 'Unlock the vault',
        'terminal.vault.manage': 'Open Vaults',
        'terminal.vault.rebind': 'Re-save the credential',
      }
      if (key === 'terminal.errorOverlay.title') return 'Connection failed'
      if (key === 'terminal.errorOverlay.dismiss') return 'Dismiss'
      return strings[key] ?? key
    },
  }),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

const tab: Tab = {
  id: 'tab-1',
  label: 'Test1',
  type: 'remote',
  hostId: 'host-1',
}

const host: Host = {
  id: 'host-1',
  name: 'Test1',
  hostname: 'example.test',
  port: 22,
  username: 'root',
  authType: 'password',
  isFavorite: false,
  portForwards: [],
  createdAt: 1,
  updatedAt: 1,
}

function renderOverlay(overrides: Record<string, unknown> = {}) {
  return render(
    <TooltipProvider>
      <TerminalErrorOverlay
        tab={tab}
        host={host}
        status="error"
        errorMessage="This host stores its credentials in the vault, which is locked."
        credentialKind="vault-locked"
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  )
}

describe('a failed connection stays on screen', () => {
  it('shows the error text in the pane, not only in a toast', () => {
    renderOverlay()
    expect(screen.getByTestId('terminal-error-overlay')).toBeTruthy()
    expect(
      screen.getByText(/stores its credentials in the vault/i),
    ).toBeTruthy()
  })

  it('names the host that failed', () => {
    // With several tabs open, "a connection failed" is not enough to know which.
    renderOverlay()
    expect(screen.getByTestId('terminal-error-overlay').textContent).toContain(
      'root@example.test',
    )
  })

  it('offers the action that fixes a locked vault', () => {
    renderOverlay()
    const action = screen.getByTestId('terminal-error-action')
    expect(action.textContent).toBe('Unlock the vault')

    fireEvent.click(action)
    expect(navigate).toHaveBeenCalledWith('/vaults')
  })

  it('offers re-saving for a damaged reference', () => {
    renderOverlay({
      credentialKind: 'credential-corrupt-reference',
      errorMessage: 'This host has a stored credential this build cannot read.',
    })
    const action = screen.getByTestId('terminal-error-action')
    expect(action.textContent).toBe('Re-save the credential')
    fireEvent.click(action)
    expect(navigate).toHaveBeenCalledWith('/hosts')
  })

  it('offers a retry for a plain network failure', () => {
    const onRetry = vi.fn()
    renderOverlay({
      credentialKind: undefined,
      errorMessage: 'connection reset by peer',
      onRetry,
    })
    // No vault action: the vault has nothing to do with this.
    expect(screen.queryByTestId('terminal-error-action')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('does not cover the terminal while the session is healthy', () => {
    // A stale error must not sit on top of a working session.
    renderOverlay({ status: 'connected' })
    expect(screen.queryByTestId('terminal-error-overlay')).toBeNull()
  })

  it('does not cover the terminal while it is still connecting', () => {
    renderOverlay({ status: 'connecting' })
    expect(screen.queryByTestId('terminal-error-overlay')).toBeNull()
  })

  it('stays until dismissed, unlike a toast', () => {
    // The point of the fix: this surface has no timer. Dismissing it is the
    // user's decision, and it is available.
    const onDismiss = vi.fn()
    renderOverlay({ onDismiss })
    expect(screen.getByTestId('terminal-error-overlay')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('renders with no vault action when the failure is not a credential one', () => {
    renderOverlay({
      credentialKind: undefined,
      errorMessage: 'Unsupported auth type: oauth',
    })
    expect(screen.getByTestId('terminal-error-overlay')).toBeTruthy()
    expect(screen.queryByTestId('terminal-error-action')).toBeNull()
  })
})

// The overlay existing is not the same as the pane using it. The previous phase
// shipped a vault action that rendered correctly and was never reached, so this
// file also has to prove the wiring: the error surface is mounted inside the
// terminal body, which is what `TerminalContainer` renders.
describe('the terminal body mounts the overlay for a real failure', () => {
  it('renders the error surface over the terminal when a connection fails', async () => {
    vi.resetModules()
    vi.doMock('./terminal-pane-header', () => ({
      TerminalPaneHeader: () => <div data-testid="pane-header" />,
    }))
    const { TerminalBody } = await import('./terminal-body')
    render(
      <TooltipProvider>
        <TerminalBody
          tab={tab}
          host={host}
          status="error"
          readableError="This host stores its credentials in the vault, which is locked."
          credentialKind="vault-locked"
          errorDismissed={false}
          isMobile={false}
          active
          isFullscreen={false}
          terminalFontSize={14}
          terminalBackground="#000"
          term={null}
          containerRef={{ current: null }}
          searchAddon={null}
          searchOpen={false}
          mobileMenuOpen={false}
          toolSidebarOpen={false}
          onSearchOpenChange={vi.fn()}
          onMobileMenuOpenChange={vi.fn()}
          onSendKey={vi.fn()}
          onFontSizeChange={vi.fn()}
          onResetFontSize={vi.fn()}
          onClear={vi.fn()}
          onToggleToolSidebar={vi.fn()}
          onToggleFullscreen={vi.fn()}
          onReconnect={vi.fn()}
          onDisconnect={vi.fn()}
          onDismissError={vi.fn()}
          onTouchStart={vi.fn()}
          onTouchEnd={vi.fn()}
          onTouchMove={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(screen.getByTestId('terminal-error-overlay')).toBeTruthy()
    expect(screen.getByTestId('terminal-error-action').textContent).toBe(
      'Unlock the vault',
    )
  })
})
