import { render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTabConnectionStatus } from '@/features/terminal/components/terminal-container/use-tab-connection-status'
import type { TerminalSessionStatus } from '@/features/terminal/services/terminal-session-manager-types'
import i18n from '@/locales'
import { useAppStore } from '@/store/app'
import {
  CONNECTION_PRESENTATION,
  TabConnectionStatus,
  type TabConnectionState,
} from './tab-connection-status'

const STATES: TabConnectionState[] = [
  'idle',
  'connecting',
  'reconnecting',
  'connected',
  'disconnected',
  'error',
]

function renderStatus(status?: TabConnectionState) {
  return render(<TabConnectionStatus status={status} />)
}

describe('TabConnectionStatus', () => {
  it.each(STATES)('renders a localized, state-tagged indicator for %s', status => {
    renderStatus(status)

    const indicator = screen.getByTestId(`tab-status-${status}`)
    expect(indicator.dataset.status).toBe(status)
    expect(indicator.getAttribute('aria-hidden')).toBe('true')

    const presentation = CONNECTION_PRESENTATION[status]
    expect(screen.getByTitle(i18n.t(presentation.labelKey))).toBeTruthy()
  })

  it.each(STATES)('exposes the translated status word for %s', status => {
    renderStatus(status)

    const expected = i18n.t(CONNECTION_PRESENTATION[status].labelKey)
    const wrapper = screen.getByTestId(`tab-connection-${status}`)
    expect(wrapper.textContent).toContain(expected)
  })

  it('keeps connecting and reconnecting visually distinct', () => {
    const { unmount } = renderStatus('connecting')
    const connectingDot = screen.getByTestId('tab-status-connecting')
    const connectingClassName = connectingDot.className
    unmount()

    renderStatus('reconnecting')
    const reconnectingDot = screen.getByTestId('tab-status-reconnecting')

    expect(connectingClassName).toContain('bg-warning')
    expect(reconnectingDot.className).toContain('bg-warning')
    expect(reconnectingDot.className).toContain('ring-1')
    expect(connectingClassName).not.toContain('ring-1')
    expect(
      screen.getByTestId('tab-status-label-reconnecting').textContent,
    ).toBe(i18n.t('terminal.status.reconnecting'))
    expect(i18n.t('terminal.status.reconnecting')).not.toBe(
      i18n.t('terminal.status.connecting'),
    )
  })

  it('keeps a failed session distinct from a plain disconnect', () => {
    const { unmount } = renderStatus('disconnected')
    const disconnectedDot = screen.getByTestId('tab-status-disconnected')
    expect(disconnectedDot.className).toContain('bg-muted-foreground/60')
    expect(screen.queryByTestId('tab-status-error')).toBeNull()
    unmount()

    renderStatus('error')
    const errorDot = screen.getByTestId('tab-status-error')
    expect(errorDot.className).toContain('bg-destructive')
    const errorLabel = screen.getByTestId('tab-status-label-error')
    expect(errorLabel.className).toContain('text-destructive')
    expect(errorLabel.textContent).toBe(i18n.t('terminal.status.error'))
    expect(i18n.t('terminal.status.error')).not.toBe(
      i18n.t('terminal.status.disconnected'),
    )
  })

  it('shows a text label only for the states a user has to act on', () => {
    const { unmount } = renderStatus('connected')
    expect(screen.queryByTestId('tab-status-label-connected')).toBeNull()
    expect(screen.getByText(i18n.t('terminal.status.connected'))).toBeTruthy()
    unmount()

    renderStatus('disconnected')
    expect(screen.getByTestId('tab-status-label-disconnected')).toBeTruthy()
  })

  it('pulses only when the platform allows motion', () => {
    renderStatus('connecting')
    expect(screen.getByTestId('tab-status-connecting').className).toContain(
      'motion-safe:animate-pulse',
    )
  })

  it('renders nothing for a tab that never opened a session', () => {
    const { container } = renderStatus()
    expect(container.firstChild).toBeNull()
  })
})

describe('tab connection status projection', () => {
  const PROJECTIONS: ReadonlyArray<[TerminalSessionStatus, string]> = [
    ['connecting', 'connecting'],
    ['reconnecting', 'reconnecting'],
    ['connected', 'connected'],
    ['disconnected', 'disconnected'],
    ['error', 'error'],
  ]

  function renderProjection(status: TerminalSessionStatus) {
    return renderHook(
      ({ next }: { next: TerminalSessionStatus }) =>
        useTabConnectionStatus('tab-a', next),
      { initialProps: { next: status } },
    )
  }

  function projectedStatus() {
    return useAppStore
      .getState()
      .tabs.find(tab => tab.id === 'tab-a')?.connectionStatus
  }

  beforeEach(() => {
    useAppStore.setState({
      tabs: [{ id: 'tab-a', label: 'A', type: 'remote', hostId: 'host-1' }],
      activeTabId: 'tab-a',
    })
  })

  it.each(PROJECTIONS)(
    'projects the session state %s onto the tab without collapsing it',
    (session, expected) => {
      renderProjection(session)
      expect(projectedStatus()).toBe(expected)
    },
  )

  it('keeps reconnecting and error out of the connecting/disconnected buckets', () => {
    const { unmount } = renderProjection('reconnecting')
    expect(projectedStatus()).not.toBe('connecting')
    unmount()

    useAppStore.setState({
      tabs: [{ id: 'tab-a', label: 'A', type: 'remote', hostId: 'host-1' }],
    })
    renderProjection('error')
    expect(projectedStatus()).not.toBe('disconnected')
  })

  it('leaves the indicator empty while the session is idle', () => {
    renderProjection('idle')
    expect(projectedStatus()).toBeUndefined()
  })
})
