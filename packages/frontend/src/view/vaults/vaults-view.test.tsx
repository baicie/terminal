import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import cn from '@/locales/cn/vaults'
import en from '@/locales/en/vaults'
import fr from '@/locales/fr/vaults'
import { buildRoutes, getVisibleNavItems, navConfig } from '@/router/nav-config'
import type * as VaultModule from '@/service/vault'
import VaultsView from './vaults-view'

const vaultMock = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  get: vi.fn(),
  isUnlocked: vi.fn(),
  list: vi.fn(),
  lock: vi.fn(),
  set: vi.fn(),
  unlock: vi.fn(),
}))

vi.mock('@/components/ui/sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

vi.mock('@/service/vault', async () => {
  const actual = await vi.importActual<typeof VaultModule>('@/service/vault')
  return { ...actual, vaultService: vaultMock }
})

function unlockSuccessfully() {
  vaultMock.exists.mockResolvedValue(true)
  vaultMock.isUnlocked.mockResolvedValue(true)
  vaultMock.list.mockResolvedValue(['alpha', 'beta'])
  vaultMock.get.mockImplementation(async (key: string) =>
    key === 'alpha' ? 'first-value' : 'second-value',
  )
}

async function renderUnlocked() {
  unlockSuccessfully()
  render(<VaultsView />)
  await screen.findByRole('listbox', { name: en['vaults.title'] })
}

async function submitMasterPassword(value = 'master-password') {
  fireEvent.change(await screen.findByLabelText(en['vaults.masterPassword']), {
    target: { value },
  })
  fireEvent.click(screen.getByRole('button', { name: en['vaults.unlock'] }))
}

beforeEach(async () => {
  vi.clearAllMocks()
  vaultMock.create.mockResolvedValue(undefined)
  vaultMock.unlock.mockResolvedValue(undefined)
  vaultMock.lock.mockResolvedValue(undefined)
  vaultMock.set.mockResolvedValue(undefined)
  vaultMock.delete.mockResolvedValue(undefined)
  vaultMock.list.mockResolvedValue([])
  vaultMock.get.mockResolvedValue('value')
  await i18n.changeLanguage('en')
})

describe('vault route reachability', () => {
  it('publishes /vaults in the shared nav config that feeds both sidebar and router', () => {
    const item = navConfig.find(entry => entry.path === '/vaults')
    expect(item?.labelKey).toBe('vaults.title')
    expect(getVisibleNavItems().some(entry => entry.path === '/vaults')).toBe(true)
  })

  it('resolves /vaults through the real route table to VaultsView', async () => {
    const vaultRoute = buildRoutes().find(route => route.path === 'vaults')
    expect(vaultRoute).toBeDefined()
    vaultMock.exists.mockResolvedValue(false)

    render(
      <MemoryRouter initialEntries={['/vaults']}>
        <Routes>
          <Route path="/vaults" element={vaultRoute?.element} />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: en['vaults.createVault'] }),
    ).toBeTruthy()
  })
})

describe('vault locale alignment', () => {
  it('defines the same vault keys in en, fr and cn', () => {
    const allKeys = new Set([
      ...Object.keys(en),
      ...Object.keys(fr),
      ...Object.keys(cn),
    ])
    for (const locale of [en, fr, cn]) {
      expect([...allKeys].filter(key => !(key in locale))).toEqual([])
    }
  })

  it('renders the unlocked vault from the active locale', async () => {
    await i18n.changeLanguage('fr')
    vaultMock.exists.mockResolvedValue(true)
    vaultMock.isUnlocked.mockResolvedValue(true)
    vaultMock.list.mockResolvedValue(['alpha'])
    vaultMock.get.mockResolvedValue('first-value')

    render(<VaultsView />)

    expect(
      await screen.findByRole('listbox', { name: fr['vaults.title'] }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: fr['vaults.deleteEntry'] })).toBeTruthy()
    expect(screen.queryByText(en['vaults.noEntries'])).toBeNull()
  })
})

describe('vault keyboard navigation', () => {
  it('keeps every entry in Tab order and activates the focused one with Enter', async () => {
    await renderUnlocked()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    for (const option of options) expect(option.tabIndex).toBe(0)

    fireEvent.keyDown(options[1], { key: 'Enter' })

    expect(options[1].getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText(en['vaults.entryDetails'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['vaults.showValue'] }))
    expect(screen.getByText('second-value')).toBeTruthy()
  })

  it('closes the entry detail pane with Escape', async () => {
    await renderUnlocked()
    fireEvent.keyDown(screen.getAllByRole('option')[0], { key: 'Enter' })
    expect(await screen.findByText(en['vaults.entryDetails'])).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByText(en['vaults.entryDetails'])).toBeNull(),
    )
    expect(screen.getByText(en['vaults.selectEntry'])).toBeTruthy()
  })

  it('dismisses the failure alert with Escape', async () => {
    await renderUnlocked()
    vaultMock.set.mockRejectedValue({ type: 'save_failed' })
    fireEvent.change(screen.getByLabelText(en['vaults.keyLabel']), {
      target: { value: 'gamma' },
    })
    fireEvent.change(screen.getByLabelText(en['vaults.valueLabel']), {
      target: { value: 'third-value' },
    })
    fireEvent.click(screen.getByRole('button', { name: en['vaults.addNewEntry'] }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      en['vaults.saveFailed'],
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('vault error states', () => {
  it('keeps a corrupt vault visible and offers no destructive action', async () => {
    vaultMock.exists.mockResolvedValue(true)
    vaultMock.isUnlocked.mockResolvedValue(false)
    vaultMock.unlock.mockRejectedValue({ type: 'corrupt' })

    render(<VaultsView />)
    await submitMasterPassword()

    expect((await screen.findByRole('alert')).textContent).toContain(
      en['vaults.corrupt'],
    )
    expect(screen.getByText(en['vaults.corruptHint'])).toBeTruthy()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('offers the create flow again when the last create did not finish', async () => {
    vaultMock.exists.mockResolvedValue(true)
    vaultMock.isUnlocked.mockResolvedValue(false)
    vaultMock.unlock.mockRejectedValue({ type: 'uninitialized' })

    render(<VaultsView />)
    await submitMasterPassword()

    expect(await screen.findByText(en['vaults.uninitialized'])).toBeTruthy()
    expect(
      screen.getByRole('button', { name: en['vaults.createVault'] }),
    ).toBeTruthy()
  })

  it('reports a failed load instead of silently dropping entries', async () => {
    vaultMock.exists.mockResolvedValue(true)
    vaultMock.isUnlocked.mockResolvedValue(true)
    vaultMock.list.mockRejectedValue({ type: 'save_failed' })

    render(<VaultsView />)

    expect((await screen.findByRole('alert')).textContent).toContain(
      en['vaults.loadFailed'],
    )
  })

  it('reports a failed save instead of silently dropping the entry', async () => {
    await renderUnlocked()
    vaultMock.set.mockRejectedValue({ type: 'save_failed' })
    fireEvent.change(screen.getByLabelText(en['vaults.keyLabel']), {
      target: { value: 'gamma' },
    })
    fireEvent.change(screen.getByLabelText(en['vaults.valueLabel']), {
      target: { value: 'third-value' },
    })
    fireEvent.click(screen.getByRole('button', { name: en['vaults.addNewEntry'] }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      en['vaults.saveFailed'],
    )
  })

  it('shows the invalid-password message on a wrong master password', async () => {
    vaultMock.exists.mockResolvedValue(true)
    vaultMock.isUnlocked.mockResolvedValue(false)
    vaultMock.unlock.mockRejectedValue({ type: 'invalid_password' })

    render(<VaultsView />)
    await submitMasterPassword('wrong-password')

    expect((await screen.findByRole('alert')).textContent).toContain(
      en['vaults.invalidPassword'],
    )
  })
})
