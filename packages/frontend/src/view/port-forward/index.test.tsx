import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import { toast } from '@/components/ui/sonner'
import PortForwardView from './index'

const mocks = vi.hoisted(() => ({
  getPortForwardRules: vi.fn(),
  createPortForwardRule: vi.fn(),
  deletePortForwardRule: vi.fn(),
  portForwardStart: vi.fn(),
  portForwardStop: vi.fn(),
}))

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/service/database', () => ({
  getPortForwardRules: mocks.getPortForwardRules,
  createPortForwardRule: mocks.createPortForwardRule,
  deletePortForwardRule: mocks.deletePortForwardRule,
}))

vi.mock('@/service/ssh', () => ({
  sshService: {
    portForwardStart: mocks.portForwardStart,
    portForwardStop: mocks.portForwardStop,
  },
}))

vi.mock('@/store/app', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ tabs: [{ id: 'tab-1', hostId: 'h-1' }], activeTabId: 'tab-1' }),
}))

vi.mock('@/store/host', () => ({
  useHostStore: (selector: (state: unknown) => unknown) =>
    selector({ hosts: [] }),
}))

vi.mock('@/hooks/use-breakpoint', () => ({
  useIsMobile: () => false,
}))

const row = {
  id: 'pf-1',
  name: 'my-forward',
  type: 'local',
  local_host: '127.0.0.1',
  local_port: 8080,
  remote_host: 'db.internal',
  remote_port: 5432,
  host_id: null,
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  mocks.getPortForwardRules.mockResolvedValue([row])
  mocks.createPortForwardRule.mockResolvedValue(undefined)
  mocks.deletePortForwardRule.mockResolvedValue(undefined)
})

describe('PortForwardView connection truthfulness', () => {
  it('reports the backend failure and keeps the rule stopped', async () => {
    mocks.portForwardStart.mockResolvedValue({
      success: false,
      message: 'tunnel refused by server',
    })
    render(<PortForwardView />)

    const start = await screen.findByTestId('port-forward-card-start')
    fireEvent.click(start)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to start port forward: tunnel refused by server',
      ),
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByText('Stopped')).toBeTruthy()
    expect(screen.getByTestId('port-forward-card-start')).toBeTruthy()
  })

  it('marks the rule active only after the backend confirms the tunnel', async () => {
    mocks.portForwardStart.mockResolvedValue({ success: true })
    render(<PortForwardView />)

    const start = await screen.findByTestId('port-forward-card-start')
    fireEvent.click(start)

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Port forward started on 127.0.0.1:8080',
      ),
    )
    expect(await screen.findByTestId('port-forward-card-stop')).toBeTruthy()
  })

  it('keeps the rule stopped when the backend reports a failed stop', async () => {
    mocks.portForwardStart.mockResolvedValue({ success: true })
    mocks.portForwardStop.mockResolvedValue({
      success: false,
      message: 'forward unknown',
    })
    render(<PortForwardView />)

    fireEvent.click(await screen.findByTestId('port-forward-card-start'))
    const stop = await screen.findByTestId('port-forward-card-stop')
    fireEvent.click(stop)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to stop port forward: forward unknown',
      ),
    )
    expect(screen.getByTestId('port-forward-card-stop')).toBeTruthy()
  })
})
