import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KeychainView from './index'

vi.mock('@/service/database', () => ({
  createSSHKey: vi.fn(),
  deleteSSHKey: vi.fn(),
  getSSHKeys: vi.fn().mockResolvedValue([]),
  searchSSHKeys: vi.fn().mockResolvedValue([]),
  updateSSHKey: vi.fn(),
}))

vi.mock('./generate-dialog', () => ({
  GenerateKeyDialog: () => null,
}))

describe('KeychainView mobile pane navigation', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
  })

  it('returns from the new-key form to the key list', async () => {
    render(<KeychainView />)

    await waitFor(() => {
      expect(screen.getByText('No keys yet')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'New' }))

    expect(screen.getAllByText('New Key').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Back to keys' }))

    expect(screen.queryByRole('button', { name: 'Back to keys' })).toBeNull()
    expect(screen.getByText('No keys yet')).toBeTruthy()
  })
})
