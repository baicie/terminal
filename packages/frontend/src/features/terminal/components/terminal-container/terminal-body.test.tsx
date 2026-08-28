import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Terminal as XTerminal } from '@baicie/xterm'
import { TerminalBody } from './terminal-body'

vi.mock('./terminal-pane-header', () => ({
  TerminalPaneHeader: () => <div data-testid="pane-header" />,
}))

vi.mock('./terminal-search-overlay', () => ({
  TerminalSearchOverlay: ({
    open,
    onClose,
  }: {
    open: boolean
    onClose: () => void
  }) => (open ? <button onClick={onClose}>Close search</button> : null),
}))

vi.mock('./terminal-mobile-menu', () => ({
  TerminalMobileMenu: () => null,
}))

vi.mock('./keyboard-bar', () => ({
  TerminalKeyboardBar: () => <div data-testid="keyboard-bar" />,
}))

vi.mock('./terminal-context-menu', () => ({
  TerminalContextMenu: ({ children }: { children: React.ReactNode }) =>
    children,
}))

vi.mock('@/components/terminal-tool-sidebar', () => ({
  default: () => null,
}))

function renderBody(term: XTerminal, active = true, isFullscreen = false) {
  const onSearchOpenChange = vi.fn()
  const containerRef = { current: null as HTMLDivElement | null }
  const bodyProps = {
    tab: { id: 'mobile-one', label: 'Mobile', type: 'local' as const },
    status: 'connected' as const,
    readableError: null,
    isMobile: true,
    terminalFontSize: 14,
    terminalBackground: '#282c34',
    term,
    containerRef,
    searchAddon: null,
    searchOpen: true,
    mobileMenuOpen: false,
    onSearchOpenChange,
    onMobileMenuOpenChange: () => {},
    onSendKey: () => {},
    onFontSizeChange: () => {},
    onResetFontSize: () => {},
    onClear: () => {},
    toolSidebarOpen: false,
    onToggleToolSidebar: () => {},
    onToggleFullscreen: () => {},
    onTouchStart: () => {},
    onTouchEnd: () => {},
    onTouchMove: () => {},
  }
  const rendered = render(
    <TerminalBody
      {...bodyProps}
      active={active}
      isFullscreen={isFullscreen}
    />,
  )
  return {
    ...rendered,
    containerRef,
    onSearchOpenChange,
    rerenderBody: (nextActive: boolean, nextFullscreen: boolean) =>
      rendered.rerender(
        <TerminalBody
          {...bodyProps}
          active={nextActive}
          isFullscreen={nextFullscreen}
        />,
      ),
  }
}

describe('TerminalBody', () => {
  it('renders find on mobile and restores xterm focus when it closes', () => {
    const focus = vi.fn()
    const { onSearchOpenChange } = renderBody({ focus } as unknown as XTerminal)

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))

    expect(onSearchOpenChange).toHaveBeenCalledWith(false)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('does not restore focus after the pane becomes inactive', () => {
    const focus = vi.fn()
    renderBody({ focus } as unknown as XTerminal, false)

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))

    expect(focus).not.toHaveBeenCalled()
  })

  it('portals fullscreen content outside the terminal stacking context', () => {
    const { container } = renderBody(
      { focus: vi.fn() } as unknown as XTerminal,
      true,
      true,
    )

    const fullscreen = document.querySelector('[data-terminal-fullscreen]')
    expect(fullscreen).toBeTruthy()
    expect(container.contains(fullscreen)).toBe(false)
    expect(fullscreen?.parentElement).toBe(document.body)
    expect(fullscreen?.classList.contains('z-[150]')).toBe(true)
  })

  it('keeps the xterm element mounted while entering and exiting fullscreen', () => {
    const terminalElement = document.createElement('div')
    const term = {
      element: terminalElement,
      focus: vi.fn(),
    } as unknown as XTerminal
    const rendered = renderBody(term, true, false)
    const initialContainer = rendered.containerRef.current
    initialContainer?.appendChild(terminalElement)

    rendered.rerenderBody(true, true)
    const fullscreenContainer = rendered.containerRef.current
    expect(fullscreenContainer).not.toBe(initialContainer)
    expect(fullscreenContainer?.contains(terminalElement)).toBe(true)
    expect(terminalElement.isConnected).toBe(true)

    rendered.rerenderBody(true, false)
    const restoredContainer = rendered.containerRef.current
    expect(restoredContainer).not.toBe(fullscreenContainer)
    expect(restoredContainer?.contains(terminalElement)).toBe(true)
    expect(terminalElement.isConnected).toBe(true)
  })

  it('does not let an inactive fullscreen pane escape the workbench', () => {
    renderBody({ focus: vi.fn() } as unknown as XTerminal, false, true)

    expect(document.querySelector('[data-terminal-fullscreen]')).toBeNull()
  })
})
