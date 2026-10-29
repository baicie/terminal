import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '@/locales'
import { TerminalSearchOverlay } from './terminal-search-overlay'

vi.mock('./use-terminal-search', () => ({
  useTerminalSearch: () => ({
    inputRef: { current: null },
    query: '[',
    setQuery: vi.fn(),
    caseSensitive: false,
    setCaseSensitive: vi.fn(),
    wholeWord: false,
    setWholeWord: vi.fn(),
    regex: true,
    setRegex: vi.fn(),
    regexError: 'Invalid regular expression',
    matchLabel: null,
    handleKeyDown: vi.fn(),
    handleNext: vi.fn(),
    handlePrevious: vi.fn(),
  }),
}))

describe('TerminalSearchOverlay', () => {
  it('associates regular-expression errors with the search input', () => {
    render(<TerminalSearchOverlay open onClose={vi.fn()} searchAddon={null} />)

    const input = screen.getByRole('textbox')
    const alert = screen.getByRole('alert')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(alert.id)
    expect(
      screen
        .getByRole('button', { name: /regular expression|正则表达式/i })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })
})
