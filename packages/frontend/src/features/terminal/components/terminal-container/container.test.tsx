import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalContainer } from './container'

const mocks = vi.hoisted(() => ({
  appState: {
    config: {} as Record<string, unknown>,
    theme: 'dark',
    tabs: [{ id: 'terminal-one', label: 'Local', type: 'local' }] as Array<{
      id: string
      label: string
      type: 'local' | 'remote'
      hostId?: string
      connectionStatus?: 'connected' | 'disconnected' | 'connecting'
    }>,
    activeTabId: 'terminal-one',
    updateTab: vi.fn(),
  },
  hosts: [] as Array<Record<string, unknown>>,
  useTerminal: vi.fn(),
  useSshHostKeyGate: vi.fn(),
  useTerminalInstance: vi.fn(),
  useTerminalShortcutEvents: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.cancel': 'Cancel',
        'common.retry': 'Retry',
        'terminal.hostKeyCheckingAria': 'Checking SSH host key',
        'terminal.hostKeyChecking': 'Checking SSH host key...',
        'terminal.hostKeyVerifyFailed': 'Could not verify the SSH host key',
      })[key] ?? key,
  }),
}))
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/terminal' }),
}))
vi.mock('@/hooks/use-breakpoint', () => ({ useIsMobile: () => false }))
vi.mock('@/store/app', () => ({
  useAppStore: (selector: (state: typeof mocks.appState) => unknown) =>
    selector(mocks.appState),
}))
vi.mock('@/store/host', () => ({
  useHostStore: (
    selector: (state: { hosts: Array<Record<string, unknown>> }) => unknown,
  ) => selector({ hosts: mocks.hosts }),
}))
vi.mock('@/utils/terminal-themes', () => ({
  getThemeColors: () => ({ background: '#000000' }),
}))
vi.mock('@/hooks/use-terminal', () => ({
  useTerminal: mocks.useTerminal,
}))
vi.mock('@/features/terminal/hooks/use-ssh-host-key-gate', () => ({
  useSshHostKeyGate: mocks.useSshHostKeyGate,
}))
vi.mock('./use-terminal-instance', () => ({
  useTerminalInstance: mocks.useTerminalInstance,
}))
vi.mock('./use-terminal-long-press', () => ({
  useTerminalLongPress: () => ({
    start: vi.fn(),
    cancel: vi.fn(),
    move: vi.fn(),
  }),
}))
vi.mock('./use-terminal-shortcut-events', () => ({
  useTerminalShortcutEvents: mocks.useTerminalShortcutEvents,
}))
vi.mock('./use-terminal-status-effects', () => ({
  useTerminalStatusEffects: vi.fn(),
}))
vi.mock('./terminal-body', () => ({ TerminalBody: () => <div /> }))
vi.mock('./terminal-empty-state', () => ({
  TerminalEmptyState: () => <div />,
}))

describe('TerminalContainer settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appState.tabs = [
      { id: 'terminal-one', label: 'Local', type: 'local' },
    ]
    mocks.appState.updateTab.mockReset()
    mocks.hosts = []
    mocks.useTerminal.mockReturnValue({
      status: 'connected',
      error: null,
      write: vi.fn(),
      reconnect: vi.fn(),
      disconnect: vi.fn(),
    })
    mocks.useSshHostKeyGate.mockReturnValue({
      status: 'ready',
      role: null,
      enabled: true,
      expectedHostKey: undefined,
      expectedJumpHostKey: undefined,
      prompt: null,
      saving: false,
      error: null,
      trustOnce: vi.fn(),
      trustAndSave: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
    })
    mocks.useTerminalInstance.mockReturnValue({
      termInstance: null,
      isReady: false,
      fitAddonRef: { current: null },
      searchAddonRef: { current: null },
      containerRef: { current: null },
      fontSize: 17,
      changeFontSize: vi.fn(),
      resetFontSize: vi.fn(),
    })
    mocks.appState.config = {
      fontSize: 17,
      fontFamily: 'Iosevka',
      cursorStyle: 'bar',
      cursorBlink: false,
      scrollback: 4321,
      allowProposedApi: false,
      terminalFontSize: 99,
      terminalFontFamily: 'Legacy Mono',
      terminalCursorBlink: true,
      terminalScrollback: 99999,
      terminalThemeDark: 'one-dark',
      terminalThemeLight: 'solarized-light',
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes canonical AppSettings fields to xterm', () => {
    render(<TerminalContainer tabId="terminal-one" workspaceId="workspace" />)

    expect(mocks.useTerminalInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        fontSize: 17,
        fontFamily: 'Iosevka',
        cursorStyle: 'bar',
        cursorBlink: false,
        scrollback: 4321,
        allowProposedApi: false,
      }),
    )
  })

  it('routes session output and status fits through the viewport controller', () => {
    const outputWriter = { write: vi.fn() }
    const requestFit = vi.fn()
    const directFit = vi.fn()
    mocks.useTerminalInstance.mockReturnValue({
      termInstance: null,
      outputWriter,
      requestFit,
      isReady: true,
      fitAddonRef: { current: { fit: directFit } },
      searchAddonRef: { current: null },
      containerRef: { current: null },
      fontSize: 17,
      changeFontSize: vi.fn(),
      resetFontSize: vi.fn(),
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    render(<TerminalContainer tabId="terminal-one" workspaceId="workspace" />)

    expect(mocks.useTerminal).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ outputWriter }),
    )
    expect(requestFit).toHaveBeenCalledOnce()
    expect(directFit).not.toHaveBeenCalled()
  })

  it('mirrors session status to the owning tab for workspace-level indicators', () => {
    render(<TerminalContainer tabId="terminal-one" workspaceId="workspace" />)

    expect(mocks.appState.updateTab).toHaveBeenCalledWith('terminal-one', {
      connectionStatus: 'connected',
    })
  })

  it('gates a remote session and forwards the exact trust-once key', () => {
    const host = {
      id: 'host-one',
      name: 'Remote',
      hostname: 'server.example.com',
      port: 22,
      username: 'deploy',
      authType: 'agent',
      isFavorite: false,
      portForwards: [],
      createdAt: 1,
      updatedAt: 1,
    }
    mocks.appState.tabs = [
      {
        id: 'terminal-one',
        label: 'Remote',
        type: 'remote',
        hostId: host.id,
      },
    ]
    mocks.hosts = [host]
    mocks.useSshHostKeyGate.mockReturnValue({
      status: 'ready',
      enabled: true,
      expectedHostKey: 'ssh-ed25519 AAAApinned',
      prompt: null,
      saving: false,
      error: null,
      trustOnce: vi.fn(),
      trustAndSave: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
    })

    render(<TerminalContainer tabId="terminal-one" workspaceId="workspace" />)

    expect(mocks.useSshHostKeyGate).toHaveBeenCalledWith({
      tabType: 'remote',
      host,
      jumpHost: undefined,
    })
    expect(mocks.useTerminal).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        enabled: true,
        expectedHostKey: 'ssh-ed25519 AAAApinned',
      }),
    )
  })

  it('passes the resolved jump host and both trust-once pins to the session', () => {
    const jumpHost = {
      id: 'jump-one',
      name: 'Bastion',
      hostname: 'jump.example.com',
      port: 22,
      username: 'operator',
      authType: 'agent',
      isFavorite: false,
      portForwards: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const host = {
      ...jumpHost,
      id: 'host-one',
      name: 'Remote',
      hostname: 'server.example.com',
      username: 'deploy',
      jumpHostId: jumpHost.id,
    }
    mocks.appState.tabs = [
      {
        id: 'terminal-one',
        label: 'Remote',
        type: 'remote',
        hostId: host.id,
      },
    ]
    mocks.hosts = [host, jumpHost]
    mocks.useSshHostKeyGate.mockReturnValue({
      status: 'ready',
      role: null,
      enabled: true,
      expectedHostKey: 'ssh-ed25519 AAAAtarget',
      expectedJumpHostKey: 'ssh-ed25519 AAAAjump',
      prompt: null,
      saving: false,
      error: null,
      trustOnce: vi.fn(),
      trustAndSave: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
    })

    render(<TerminalContainer tabId="terminal-one" workspaceId="workspace" />)

    expect(mocks.useSshHostKeyGate).toHaveBeenCalledWith({
      tabType: 'remote',
      host,
      jumpHost,
    })
    expect(mocks.useTerminal).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        expectedHostKey: 'ssh-ed25519 AAAAtarget',
        expectedJumpHostKey: 'ssh-ed25519 AAAAjump',
        host,
        jumpHost,
      }),
    )
  })

  it('shows a recoverable preflight error while keeping the session disabled', () => {
    const retry = vi.fn()
    mocks.useSshHostKeyGate.mockReturnValue({
      status: 'error',
      enabled: false,
      expectedHostKey: undefined,
      prompt: null,
      saving: false,
      error: 'network offline',
      trustOnce: vi.fn(),
      trustAndSave: vi.fn(),
      cancel: vi.fn(),
      retry,
    })

    render(<TerminalContainer tabId="terminal-one" workspaceId="workspace" />)

    expect(screen.getByRole('alert').textContent).toContain('network offline')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
    expect(mocks.useTerminal).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ enabled: false }),
    )
  })

  it('shows host-key checking progress while the session is disabled', () => {
    mocks.useSshHostKeyGate.mockReturnValue({
      status: 'checking',
      enabled: false,
      expectedHostKey: undefined,
      prompt: null,
      saving: false,
      error: null,
      trustOnce: vi.fn(),
      trustAndSave: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
    })

    render(<TerminalContainer tabId="terminal-one" workspaceId="workspace" />)

    expect(
      screen.getByRole('status', { name: 'Checking SSH host key' }),
    ).toBeTruthy()
    expect(mocks.useTerminal).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ enabled: false }),
    )
  })

  it('routes reconnect shortcuts back through host-key preflight while gated', () => {
    const retry = vi.fn()
    const reconnect = vi.fn()
    mocks.useTerminal.mockReturnValue({
      status: 'idle',
      error: null,
      write: vi.fn(),
      reconnect,
      disconnect: vi.fn(),
    })
    mocks.useSshHostKeyGate.mockReturnValue({
      status: 'error',
      enabled: false,
      expectedHostKey: undefined,
      prompt: null,
      saving: false,
      error: 'network offline',
      trustOnce: vi.fn(),
      trustAndSave: vi.fn(),
      cancel: vi.fn(),
      retry,
    })

    render(<TerminalContainer tabId="terminal-one" workspaceId="workspace" />)
    const shortcutOptions =
      mocks.useTerminalShortcutEvents.mock.calls.at(-1)?.[0]
    shortcutOptions.onReconnect()

    expect(retry).toHaveBeenCalledOnce()
    expect(reconnect).not.toHaveBeenCalled()
  })
})
