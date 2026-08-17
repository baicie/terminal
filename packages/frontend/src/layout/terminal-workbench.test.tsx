import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SplitGroup, Tab } from '@/types'
import { TerminalWorkbench } from './terminal-workbench'

const tabs: Tab[] = [
  { id: 'one', label: 'One', type: 'local' },
  { id: 'two', label: 'Two', type: 'remote', hostId: 'host-1' },
]

const splitGroup: SplitGroup = {
  id: 'split-1',
  mode: 'horizontal',
  tabs: ['one', 'two'],
  sizes: [45, 55],
}

describe('TerminalWorkbench', () => {
  it('activates a split pane when it receives pointer input', () => {
    const onActivateTab = vi.fn()
    render(
      <TerminalWorkbench
        tabs={tabs}
        visibleTabIds={new Set(['one', 'two'])}
        splitGroup={splitGroup}
        activeTabId="one"
        isTerminalRoute
        onActivateTab={onActivateTab}
        onResizeSplit={() => {}}
        renderTerminal={tabId => <div>{tabId}</div>}
      />,
    )

    fireEvent.pointerDown(screen.getByRole('group', { name: 'Two' }))

    expect(onActivateTab).toHaveBeenCalledWith('two')
  })

  it('activates before an xterm child can stop pointer propagation', () => {
    const onActivateTab = vi.fn()
    render(
      <TerminalWorkbench
        tabs={tabs}
        visibleTabIds={new Set(['one', 'two'])}
        splitGroup={splitGroup}
        activeTabId="one"
        isTerminalRoute
        onActivateTab={onActivateTab}
        onResizeSplit={() => {}}
        renderTerminal={tabId => (
          <button onPointerDown={event => event.stopPropagation()}>
            terminal-{tabId}
          </button>
        )}
      />,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'terminal-two' }))

    expect(onActivateTab).toHaveBeenCalledWith('two')
  })

  it('supports synthesized click activation without pointer events', () => {
    const onActivateTab = vi.fn()
    render(
      <TerminalWorkbench
        tabs={tabs}
        visibleTabIds={new Set(['one', 'two'])}
        splitGroup={splitGroup}
        activeTabId="one"
        isTerminalRoute
        onActivateTab={onActivateTab}
        onResizeSplit={() => {}}
        renderTerminal={tabId => (
          <button onClick={event => event.stopPropagation()}>
            terminal-{tabId}
          </button>
        )}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'terminal-two' }))

    expect(onActivateTab).toHaveBeenCalledWith('two')
  })

  it('marks only the active pane as current', () => {
    render(
      <TerminalWorkbench
        tabs={tabs}
        visibleTabIds={new Set(['one', 'two'])}
        splitGroup={splitGroup}
        activeTabId="two"
        isTerminalRoute
        onActivateTab={() => {}}
        onResizeSplit={() => {}}
        renderTerminal={tabId => <div>{tabId}</div>}
      />,
    )

    const inactivePane = screen.getByRole('group', { name: 'One' })
    const activePane = screen.getByRole('group', { name: 'Two' })
    expect(inactivePane.getAttribute('data-active')).toBe('false')
    expect(inactivePane.getAttribute('aria-current')).toBeNull()
    expect(inactivePane.className).not.toContain('ring-1')
    expect(activePane.getAttribute('data-active')).toBe('true')
    expect(activePane.getAttribute('aria-current')).toBe('true')
    expect(activePane.className).toContain('ring-1')
  })

  it('commits a keyboard resize to the split group', () => {
    const onResizeSplit = vi.fn()
    render(
      <TerminalWorkbench
        tabs={tabs}
        visibleTabIds={new Set(['one', 'two'])}
        splitGroup={splitGroup}
        activeTabId="one"
        isTerminalRoute
        onActivateTab={() => {}}
        onResizeSplit={onResizeSplit}
        renderTerminal={tabId => <div>{tabId}</div>}
      />,
    )

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })

    expect(onResizeSplit).toHaveBeenCalledWith('split-1', [50, 50])
  })
})
