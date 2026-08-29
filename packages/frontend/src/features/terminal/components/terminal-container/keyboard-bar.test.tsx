import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalKeyboardBar } from './keyboard-bar'
import { applyKeyboardModifiers } from './keyboard-bar-data'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'shortcuts.title': 'Keyboard shortcuts',
        'terminal.clearScreen': 'Clear screen',
        'terminal.decreaseFontSize': 'Decrease font size',
        'terminal.fullscreen': 'Fullscreen',
        'terminal.increaseFontSize': 'Increase font size',
        'terminal.keyboardHelpDescription': 'Terminal control sequences',
      })[key] ?? key,
  }),
}))

describe('TerminalKeyboardBar', () => {
  it.each([
    [' ', '\x00'],
    ['@', '\x00'],
    ['2', '\x00'],
    ['A', '\x01'],
    ['z', '\x1a'],
    ['[', '\x1b'],
    ['3', '\x1b'],
    ['\\', '\x1c'],
    ['4', '\x1c'],
    [']', '\x1d'],
    ['5', '\x1d'],
    ['^', '\x1e'],
    ['6', '\x1e'],
    ['_', '\x1f'],
    ['7', '\x1f'],
    ['/', '\x1f'],
    ['8', '\x7f'],
    ['?', '\x7f'],
  ])('maps Ctrl+%s to its ASCII control code', (key, expected) => {
    expect(applyKeyboardModifiers(key, { ctrl: true, alt: false })).toBe(
      expected,
    )
  })

  it('applies the Alt Escape prefix after Ctrl mapping', () => {
    expect(applyKeyboardModifiers('c', { ctrl: true, alt: true })).toBe(
      '\x1b\x03',
    )
  })

  it('uses touch-sized controls and accessible action labels', () => {
    render(
      <TerminalKeyboardBar
        onSendKey={vi.fn()}
        onFontSizeChange={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Ctrl' }).className).toContain(
      'h-11',
    )
    expect(screen.getByRole('button', { name: 'Esc' }).className).toContain(
      'h-11',
    )
    expect(
      screen.getByRole('button', { name: 'Decrease font size' }).className,
    ).toContain('size-11')
    expect(screen.getByRole('button', { name: 'Clear screen' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Fullscreen' })).not.toBeNull()
  })

  it('returns focus to the terminal after a mobile keyboard action', () => {
    const onRequestFocus = vi.fn()
    const onSendKey = vi.fn()
    render(
      <TerminalKeyboardBar
        onSendKey={onSendKey}
        onRequestFocus={onRequestFocus}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Esc' }))

    expect(onSendKey).toHaveBeenCalledWith('\x1b')
    expect(onRequestFocus).toHaveBeenCalledOnce()
  })

  it('maps the next printable key to a Ctrl control code and consumes Ctrl', () => {
    const onRequestFocus = vi.fn()
    const onSendKey = vi.fn()
    render(
      <>
        <TerminalKeyboardBar
          onSendKey={onSendKey}
          onRequestFocus={() => {
            screen.getByLabelText('xterm input').focus()
            onRequestFocus()
          }}
        />
        <textarea aria-label="xterm input" />
      </>,
    )

    const ctrl = screen.getByRole('button', { name: 'Ctrl' })
    fireEvent.click(ctrl)
    expect(ctrl.getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(screen.getByLabelText('xterm input'), { key: 'c' })

    expect(onSendKey).toHaveBeenCalledOnce()
    expect(onSendKey).toHaveBeenCalledWith('\x03')
    expect(ctrl.getAttribute('aria-pressed')).toBe('false')
    expect(onRequestFocus).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(screen.getByLabelText('xterm input'), { key: 'c' })
    expect(onSendKey).toHaveBeenCalledOnce()
  })

  it('prefixes the next printable key with Escape and consumes Alt', () => {
    const onSendKey = vi.fn()
    render(
      <>
        <TerminalKeyboardBar
          onSendKey={onSendKey}
          onRequestFocus={() => screen.getByLabelText('xterm input').focus()}
        />
        <textarea aria-label="xterm input" />
      </>,
    )

    const alt = screen.getByRole('button', { name: 'Alt' })
    fireEvent.click(alt)
    expect(alt.getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(screen.getByLabelText('xterm input'), { key: 'x' })

    expect(onSendKey).toHaveBeenCalledOnce()
    expect(onSendKey).toHaveBeenCalledWith('\x1bx')
    expect(alt.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders an accessible localized help sheet and restores focus after clear', () => {
    const onRequestFocus = vi.fn()
    const onSendKey = vi.fn()
    render(
      <TerminalKeyboardBar
        onSendKey={onSendKey}
        onRequestFocus={onRequestFocus}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))

    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    const descriptionId = dialog.getAttribute('aria-describedby')
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      'Terminal control sequences',
    )
    expect(dialog.querySelector('[data-slot="separator"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear screen' }))

    expect(onSendKey).toHaveBeenCalledWith('\x1b[2J\x1b[H')
    expect(onRequestFocus).toHaveBeenCalledOnce()
  })
})
