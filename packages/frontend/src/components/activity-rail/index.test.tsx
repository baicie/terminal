// UX-1a/1b — the rail switches surfaces without touching the terminal.
//
// Two things changed in UX-1b and both are pinned here:
//
// 1. the terminal entry is a **button**, not a link. Clicking it closes the left
//    panel and returns to `/terminal`; it does not navigate *away* from the canvas
//    to a different page.
// 2. a **Connections** entry toggles the Connection Explorer, which is the panel
//    the rail exists for now. It also does not navigate away.
//
// The invariant these tests defend is unchanged: the rail never owns a session.
// It renders no terminal and holds no PTY state, so no click can take one with it.

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/app'
import { useRightPanelStore } from '@/store/right-panel-store'
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
  beforeEach(() => {
    useAppStore.setState({ leftPanel: 'none' })
    useRightPanelStore.setState({ rightPanel: 'none' })
  })

  it('offers the terminal as the first control', () => {
    renderRail()
    const terminal = screen.getByTestId('rail-terminal')
    // A button, because its job is "close the panel and go back to the canvas",
    // not "navigate to another page". The old assertion expected `href="/terminal"`.
    expect(terminal.tagName).toBe('BUTTON')
    expect(terminal.getAttribute('aria-pressed')).toBe('true')
  })

  it('toggles the connection explorer without leaving the terminal', () => {
    renderRail()
    const connections = screen.getByTestId('rail-connections')
    expect(connections.tagName).toBe('BUTTON')
    expect(connections.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(connections)
    expect(useAppStore.getState().leftPanel).toBe('explorer')
    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })

  it('closes the explorer when the connections entry is clicked again', () => {
    useAppStore.setState({ leftPanel: 'explorer', sidebarVisible: true })
    renderRail()

    fireEvent.click(screen.getByTestId('rail-connections'))

    expect(useAppStore.getState().leftPanel).toBe('none')
    expect(useAppStore.getState().sidebarVisible).toBe(false)
  })

  it('closes whichever panel is open when the terminal entry is clicked', () => {
    useAppStore.setState({ leftPanel: 'navigation', sidebarVisible: true })
    renderRail()

    fireEvent.click(screen.getByTestId('rail-terminal'))

    expect(useAppStore.getState().leftPanel).toBe('none')
    expect(useAppStore.getState().sidebarVisible).toBe(false)
  })

  it('reaches the management surfaces through real links', () => {
    // SFTP is deliberately absent from this list: since UX-1c it opens the dock
    // instead of navigating, because it is a panel you work in while the terminal
    // keeps running. `/sftp` still exists as a deep link.
    renderRail()
    for (const path of ['hosts', 'keychain', 'snippets', 'port-forward']) {
      const link = screen.getByTestId(`rail-${path}`)
      // A link, not an onClick handler: it keeps middle-click and the router's
      // own navigation working, and it cannot swallow the click.
      expect(link.getAttribute('href')).toBe(`/${path}`)
    }
  })

  it('opens the SFTP dock instead of navigating away from the canvas', () => {
    renderRail()
    const files = screen.getByTestId('rail-sftp')
    expect(files.tagName).toBe('BUTTON')
    expect(files.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(files)
    expect(useRightPanelStore.getState().rightPanel).toBe('sftp')

    fireEvent.click(files)
    expect(useRightPanelStore.getState().rightPanel).toBe('none')
  })

  it('does not reach the advanced surfaces', () => {
    // Teams, logs, known hosts and vaults live in the navigation panel and the
    // command palette. A permanent rail slot costs terminal width every second.
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
    // The rail renders no terminal and holds no session state: a click is either
    // an anchor navigation or a panel toggle. Asserting "no session-ish nodes" is
    // the cheap version of "the rail cannot take the PTY with it".
    const { container } = renderRail()
    expect(container.querySelector('[data-terminal-workbench]')).toBeNull()
    fireEvent.click(screen.getByTestId('rail-hosts'))
    expect(container.querySelector('[data-terminal-workbench]')).toBeNull()
    fireEvent.click(screen.getByTestId('rail-connections'))
    expect(container.querySelector('[data-terminal-workbench]')).toBeNull()
  })
})
