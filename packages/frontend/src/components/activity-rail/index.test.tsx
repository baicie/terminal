// UX-1a — the rail switches surfaces without touching the terminal.
//
// The rail is the one new element that can break the single-mount invariant: it
// navigates, and a naive implementation that renders the terminal inside a routed
// component would rebuild the PTY on every click. The mount point is unchanged
// (`main-layout-content.tsx` keeps `TerminalByUrl` outside the outlet); these
// tests pin the rail's own contract so it cannot drift into owning a session.

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ActivityRail } from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderRail(initial = '/terminal') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <TooltipProvider>
        <ActivityRail />
      </TooltipProvider>
    </MemoryRouter>,
  )
}

describe('activity rail', () => {
  it('offers the terminal as the first destination', () => {
    renderRail()
    const terminal = screen.getByTestId('rail-terminal')
    expect(terminal.getAttribute('href')).toBe('/terminal')
  })

  it('reaches the daily surfaces through real links', () => {
    renderRail()
    for (const path of ['hosts', 'sftp', 'keychain', 'snippets', 'port-forward']) {
      const link = screen.getByTestId(`rail-${path}`)
      // A link, not an onClick handler: it keeps middle-click and the router's
      // own navigation working, and it cannot swallow the click.
      expect(link.getAttribute('href')).toBe(`/${path}`)
    }
  })

  it('does not reach the advanced surfaces', () => {
    // Teams, logs, known hosts and vaults are not daily; a permanent rail slot
    // for them costs terminal width every second of the day.
    renderRail()
    for (const path of ['teams', 'logs', 'known-hosts', 'vaults']) {
      expect(screen.queryByTestId(`rail-${path}`)).toBeNull()
    }
  })

  it('marks the current destination without hiding the others', () => {
    renderRail('/hosts')
    // `aria-current` is what NavLink sets on the active route, and it is also what
    // a screen reader announces. Asserting the class name would test the styling
    // twice and the semantics never.
    expect(screen.getByTestId('rail-hosts').getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByTestId('rail-sftp').getAttribute('aria-current')).toBeNull()
  })

  it('navigates without unmounting anything the rail does not own', () => {
    // The rail renders no terminal and holds no session state: a click is an
    // anchor navigation. Asserting "no session-ish props" is the cheap version of
    // "the rail cannot take the PTY with it".
    const { container } = renderRail()
    expect(container.querySelector('[data-terminal-workbench]')).toBeNull()
    fireEvent.click(screen.getByTestId('rail-hosts'))
    expect(container.querySelector('[data-terminal-workbench]')).toBeNull()
  })
})
