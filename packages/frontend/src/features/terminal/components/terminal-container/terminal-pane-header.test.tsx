import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Host, Tab } from '@/types'
import { TerminalPaneHeader } from './terminal-pane-header'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { code?: number }) =>
      ({
        'common.retry': 'Retry',
        'terminal.clear': 'Clear',
        'terminal.search': 'Find',
        'terminal.showTools': 'Show tools',
        'terminal.fullscreen': 'Fullscreen',
        'terminal.status.connected': 'Connected',
        'terminal.status.reconnecting': 'Reconnecting',
        'terminal.status.error': 'Error',
        'terminal.status.retryExhausted': 'Waiting to retry',
        'terminal.retryExhaustedHint':
          'Automatic retries resume 30 seconds after each retry window. Retry now or disconnect.',
        'terminal.disconnect': 'Disconnect',
        'terminal.lastCommandSucceeded': 'Last command succeeded',
        'terminal.lastCommandFailed': `Last command exited with code ${options?.code}`,
        'toolbar.more': 'More',
      })[key] ?? key,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}))

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
  authType: 'agent',
  isFavorite: false,
  portForwards: [],
  createdAt: 1,
  updatedAt: 1,
}

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    tab,
    host,
    status: 'connected' as const,
    fontSize: 14,
    isMobile: false,
    toolsOpen: false,
    fullscreen: false,
    onSearch: vi.fn(),
    onClear: vi.fn(),
    onToggleTools: vi.fn(),
    onFontSizeChange: vi.fn(),
    onResetFontSize: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onRequestFocus: vi.fn(),
    ...overrides,
  }
}

function renderHeader(props = createProps()) {
  return render(
    <TooltipProvider>
      <TerminalPaneHeader {...props} />
    </TooltipProvider>,
  )
}

describe('TerminalPaneHeader', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores terminal focus after a direct pane action', () => {
    const props = createProps()
    renderHeader(props)

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(props.onClear).toHaveBeenCalledOnce()
    expect(props.onRequestFocus).toHaveBeenCalledOnce()
  })

  it('leaves focus with the search surface when opening find', () => {
    const props = createProps()
    renderHeader(props)

    fireEvent.click(screen.getByRole('button', { name: 'Find' }))

    expect(props.onSearch).toHaveBeenCalledOnce()
    expect(props.onRequestFocus).not.toHaveBeenCalled()
  })

  it('uses a touch-sized mobile menu trigger', () => {
    renderHeader(createProps({ isMobile: true }))

    const trigger = screen.getByRole('button', { name: 'More' })
    expect(trigger.className).toContain('size-11')
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('allows an in-progress reconnect to be retried now or stopped', () => {
    const onReconnect = vi.fn()
    const onDisconnect = vi.fn()
    renderHeader(
      createProps({ status: 'reconnecting', onReconnect, onDisconnect }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(onReconnect).toHaveBeenCalledOnce()
    expect(onDisconnect).toHaveBeenCalledOnce()
  })

  it('exposes the shell current directory when integration reports it', () => {
    renderHeader(createProps({ shellCwd: '/srv/app' }))

    const target = screen.getByTitle(
      'Production · deploy@prod.example.com:22 · /srv/app',
    )
    expect(target.getAttribute('data-shell-cwd')).toBe('/srv/app')
    expect(target.textContent).toContain('/srv/app')
  })

  it('shows the exit status of the last command the shell reported', () => {
    const { rerender } = renderHeader(createProps({ lastExitCode: 0 }))

    expect(screen.getByText(/Last command succeeded/)).toBeTruthy()

    rerender(
      <TooltipProvider>
        <TerminalPaneHeader {...createProps({ lastExitCode: 130 })} />
      </TooltipProvider>,
    )
    expect(screen.getByText(/exited with code 130/)).toBeTruthy()
  })

  it('claims no command status when the shell reported none', () => {
    // A pane whose shell integration never fired must not imply the previous
    // command succeeded: an absent signal is not a zero exit code.
    renderHeader(createProps({ lastExitCode: undefined }))

    expect(screen.queryByText(/Last command/)).toBeNull()
  })

  it('presents an exhausted but retryable error as recoverable, not failed', () => {
    const onReconnect = vi.fn()
    renderHeader(
      createProps({
        status: 'error',
        errorMessage: 'network unavailable',
        reconnectRetryable: true,
        onReconnect,
      }),
    )

    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Waiting to retry')
    expect(status.textContent).not.toContain('Error')
    expect(status.getAttribute('title')).toContain('30 seconds after each')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onReconnect).toHaveBeenCalledOnce()
  })

  it('keeps a non-retryable error marked as a hard failure', () => {
    renderHeader(
      createProps({
        status: 'error',
        errorMessage: 'host key rejected',
        reconnectRetryable: false,
      }),
    )

    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Error')
    expect(status.textContent).not.toContain('Retrying soon')
  })
})
