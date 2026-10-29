import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Terminal as XTerminal } from '@baicie/xterm'
import { TerminalMobileMenu } from './terminal-mobile-menu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.actions': 'Actions',
        'terminal.mobileMenuDescription': 'Terminal actions',
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

describe('TerminalMobileMenu', () => {
  it('exposes an accessible action sheet with touch-sized controls', () => {
    render(
      <TerminalMobileMenu
        term={{} as XTerminal}
        onFontSizeChange={vi.fn()}
        onOpenSearch={vi.fn()}
        open
        onOpenChange={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Actions' })
    const descriptionId = dialog.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      'Terminal actions',
    )
    expect(screen.getByRole('button', { name: 'Copy' }).className).toContain(
      'h-12',
    )
    expect(document.querySelector('[data-slot="separator"]')).not.toBeNull()
  })
})
