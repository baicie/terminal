import type { Terminal as XTerminal } from '@baicie/xterm'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalContextMenu } from './terminal-context-menu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'terminal.copy': 'Copy',
        'terminal.paste': 'Paste',
        'terminal.selectAll': 'Select all',
        'terminal.clear': 'Clear',
        'terminal.search': 'Find',
        'terminal.zoomIn': 'Zoom in',
        'terminal.zoomOut': 'Zoom out',
      })[key] ?? key,
  }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}))

function createTerminal(focusTarget: () => HTMLElement | null) {
  return {
    clear: vi.fn(),
    focus: vi.fn(() => focusTarget()?.focus()),
    getSelection: vi.fn(() => 'selected text'),
    paste: vi.fn(),
    selectAll: vi.fn(),
  } as unknown as XTerminal
}

function ContextMenuHarness({
  term,
  onFontSizeChange = vi.fn(),
  onOpenSearch,
}: {
  term: XTerminal
  onFontSizeChange?: (delta: number) => void
  onOpenSearch?: () => void
}) {
  return (
    <>
      <TerminalContextMenu
        term={term}
        onFontSizeChange={onFontSizeChange}
        onOpenSearch={onOpenSearch}
      >
        <div role="application" aria-label="Terminal surface" tabIndex={0} />
      </TerminalContextMenu>
      <textarea aria-label="xterm input" />
    </>
  )
}

function SearchInput() {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])
  return <input ref={inputRef} aria-label="Find in terminal" />
}

describe('TerminalContextMenu', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0)
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue('clipboard text'),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['Copy', 'Paste', 'Select all', 'Clear', 'Zoom in', 'Zoom out'])(
    'returns focus to xterm after choosing %s',
    async action => {
      const term = createTerminal(() => screen.getByLabelText('xterm input'))
      render(<ContextMenuHarness term={term} />)

      fireEvent.contextMenu(screen.getByRole('application'))
      fireEvent.click(
        await screen.findByRole('menuitem', { name: new RegExp(`^${action}`) }),
      )

      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByLabelText('xterm input'),
        )
      })
    },
  )

  it('leaves focus with the search input after choosing Find', async () => {
    let term: XTerminal
    function SearchHarness() {
      const [searchOpen, setSearchOpen] = useState(false)
      return (
        <>
          <ContextMenuHarness
            term={term}
            onOpenSearch={() => setSearchOpen(true)}
          />
          {searchOpen ? <SearchInput /> : null}
        </>
      )
    }

    term = createTerminal(() => screen.getByLabelText('xterm input'))
    render(<SearchHarness />)

    fireEvent.contextMenu(screen.getByRole('application'))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Find/ }))

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByLabelText('Find in terminal'),
      )
    })
    expect(term.focus).not.toHaveBeenCalled()
  })
})
