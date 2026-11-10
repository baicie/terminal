import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import BottomNav from './index'

function RouteControls() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <>
      <output data-testid="location">{location.pathname}</output>
      <button type="button" onClick={() => navigate('/terminal?tab=one')}>
        Open terminal
      </button>
    </>
  )
}

function renderBottomNav(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BottomNav />
      <RouteControls />
    </MemoryRouter>,
  )
}

describe('BottomNav route activation', () => {
  it('marks Terminal as the current page on the terminal route', () => {
    renderBottomNav('/terminal?tab=one')

    expect(
      screen
        .getByRole('button', { name: 'Terminal' })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(
      screen
        .getByRole('button', { name: 'Hosts' })
        .getAttribute('aria-current'),
    ).toBeNull()
  })

  it('updates the current page when the route changes', () => {
    renderBottomNav('/hosts')

    expect(
      screen
        .getByRole('button', { name: 'Hosts' })
        .getAttribute('aria-current'),
    ).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))

    expect(screen.getByTestId('location').textContent).toBe('/terminal')
    expect(
      screen
        .getByRole('button', { name: 'Terminal' })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(
      screen
        .getByRole('button', { name: 'Hosts' })
        .getAttribute('aria-current'),
    ).toBeNull()
  })

  it('marks More as current for secondary navigation routes', () => {
    renderBottomNav('/settings')

    expect(
      screen
        .getByRole('button', { name: 'More options' })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(
      screen
        .getByRole('button', { name: 'Hosts' })
        .getAttribute('aria-current'),
    ).toBeNull()
  })
})

describe('WP-D — the vault is reachable when the sidebar is not', () => {
  it('offers a Vaults entry in the More sheet', () => {
    renderBottomNav('/hosts')
    // Below `md` the sidebar is not mounted, so this sheet is the only navigation.
    fireEvent.click(screen.getByRole('button', { name: /more/i }))

    // If this fails there is no way to unlock the vault in a narrow window, and
    // a locked vault means no SSH connection can be made at all.
    expect(screen.getByRole('button', { name: 'Vaults' })).toBeTruthy()
  })

  it('navigates to the vaults route from the sheet', () => {
    renderBottomNav('/hosts')
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Vaults' }))
    expect(screen.getByTestId('location').textContent).toBe('/vaults')
  })
})
