import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store/app'
import '@/locales'
import MenuTabs from './tabs'

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => {},
})

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  )
}

function renderTabs() {
  return render(
    <MemoryRouter initialEntries={['/hosts']}>
      <MenuTabs />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('MenuTabs', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [
        { id: 'one', label: 'One', type: 'local' },
        { id: 'two', label: 'Two', type: 'remote', hostId: 'host-1' },
      ],
      splitGroups: [],
      activeTabId: 'one',
      recentlyClosedTabs: [],
    })
  })

  it('activates a session and opens the terminal route', () => {
    renderTabs()

    fireEvent.click(screen.getByRole('tab', { name: 'Two' }))

    expect(useAppStore.getState().activeTabId).toBe('two')
    expect(screen.getByTestId('location').textContent).toBe('/terminal')
  })

  it('activates and focuses tabs with roving arrow-key navigation', () => {
    renderTabs()

    const firstTab = screen.getByRole('tab', { name: 'One' })
    const secondTab = screen.getByRole('tab', { name: 'Two' })
    firstTab.focus()

    fireEvent.keyDown(firstTab, { key: 'ArrowRight' })

    expect(useAppStore.getState().activeTabId).toBe('two')
    expect(secondTab.getAttribute('tabindex')).toBe('0')
    expect(firstTab.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(secondTab)
    expect(screen.getByTestId('location').textContent).toBe('/terminal')

    fireEvent.keyDown(secondTab, { key: 'ArrowRight' })
    expect(useAppStore.getState().activeTabId).toBe('one')
    expect(document.activeElement).toBe(firstTab)

    fireEvent.keyDown(firstTab, { key: 'ArrowLeft' })
    expect(useAppStore.getState().activeTabId).toBe('two')
    expect(document.activeElement).toBe(secondTab)
  })

  it('supports Home and End in the tablist', () => {
    renderTabs()

    const firstTab = screen.getByRole('tab', { name: 'One' })
    const secondTab = screen.getByRole('tab', { name: 'Two' })
    firstTab.focus()

    fireEvent.keyDown(firstTab, { key: 'End' })
    expect(useAppStore.getState().activeTabId).toBe('two')
    expect(document.activeElement).toBe(secondTab)

    fireEvent.keyDown(secondTab, { key: 'Home' })
    expect(useAppStore.getState().activeTabId).toBe('one')
    expect(document.activeElement).toBe(firstTab)
  })

  it('closes a session from its direct action', () => {
    renderTabs()

    fireEvent.click(screen.getByRole('button', { name: /Close One/i }))

    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual(['two'])
    expect(useAppStore.getState().activeTabId).toBe('two')
  })

  it('splits a session from the shadcn context menu', async () => {
    renderTabs()

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'One' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Split Vertical/i }),
    )

    await waitFor(() => {
      expect(useAppStore.getState().splitGroups).toHaveLength(1)
    })
    expect(useAppStore.getState().tabs).toHaveLength(3)
  })

  it('wires horizontal split and leaving the split through the menu', async () => {
    renderTabs()

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'One' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Split Horizontal/i }),
    )

    await waitFor(() => {
      expect(useAppStore.getState().splitGroups[0]?.mode).toBe('horizontal')
    })
    fireEvent.contextMenu(screen.getAllByRole('tab', { name: 'One' })[0])
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Close Split/i }),
    )

    expect(useAppStore.getState().splitGroups).toHaveLength(0)
    expect(useAppStore.getState().tabs).toHaveLength(3)
    expect(useAppStore.getState().tabs.every(tab => !tab.splitId)).toBe(true)
  })

  it('moves complete tab groups left and right through the menu', async () => {
    renderTabs()

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Two' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Move Left/i }),
    )
    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual([
      'two',
      'one',
    ])

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Two' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Move Right/i }),
    )
    expect(useAppStore.getState().tabs.map(tab => tab.id)).toEqual([
      'one',
      'two',
    ])
  })

  it('disables split actions for serial tabs and does not create a pane', async () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'serial-one',
          label: 'Serial One',
          type: 'serial',
          serialSessionId: 'serial-session-1',
        },
      ],
      activeTabId: 'serial-one',
    })
    renderTabs()

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Serial One' }))
    const horizontal = await screen.findByRole('menuitem', {
      name: /Split Horizontal/i,
    })
    const vertical = screen.getByRole('menuitem', { name: /Split Vertical/i })

    expect(horizontal.hasAttribute('data-disabled')).toBe(true)
    expect(vertical.hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(horizontal)
    fireEvent.click(vertical)
    expect(useAppStore.getState().tabs).toHaveLength(1)
    expect(useAppStore.getState().splitGroups).toHaveLength(0)
  })

  it('keeps tab and close actions touch-sized on mobile and compact on desktop', () => {
    renderTabs()

    const tab = screen.getByRole('tab', { name: 'One' })
    const close = screen.getByRole('button', { name: /Close One/i })

    expect(tab.className).toContain('h-11')
    expect(tab.className).toContain('min-w-11')
    expect(tab.className).toContain('sm:h-8')
    expect(tab.className).toContain('sm:min-w-0')
    expect(close.className).toContain('size-11')
    expect(close.className).toContain('sm:size-8')
    expect(tab.className).toContain('touch-manipulation')
    expect(close.className).toContain('touch-manipulation')
  })
})
