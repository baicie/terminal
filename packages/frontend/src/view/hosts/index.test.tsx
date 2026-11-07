import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en'
import { useHostStore } from '@/store/host'
import HostsView from './index'

const mocks = vi.hoisted(() => ({
  loadHosts: vi.fn(),
  loadGroups: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
  mocks.loadGroups.mockResolvedValue(undefined)
  useHostStore.setState({
    loadHosts: mocks.loadHosts as never,
    loadGroups: mocks.loadGroups as never,
    hosts: [],
  })
})

describe('hosts view failure state', () => {
  it('shows the load error and retries instead of reporting an empty list', async () => {
    mocks.loadHosts.mockRejectedValueOnce(new Error('database is locked'))
    render(
      <MemoryRouter>
        <HostsView />
      </MemoryRouter>,
    )

    expect(await screen.findByText(en['hosts.loadFailed'])).toBeTruthy()
    expect(screen.getByText('database is locked')).toBeTruthy()

    mocks.loadHosts.mockResolvedValueOnce([])
    fireEvent.click(screen.getByRole('button', { name: en['common.retry'] }))

    await waitFor(() => expect(mocks.loadHosts).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByText(en['hosts.loadFailed'])).toBeNull(),
    )
  })
})
