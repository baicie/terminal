// UX-1a — the status bar must not invent state.
//
// Every field is optional, and the tests below are mostly about what is *absent*.
// A status bar that prints "Connected" because a tab exists is worse than an empty
// one: it teaches the user to ignore the indicator that would have warned them, and
// this project has shipped exactly that class of lie before ("connected" while the
// vault was locked).

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StatusBar } from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'statusBar.transfers'
        ? `${options?.count} transfers`
        : key.replace('terminal.status.', ''),
  }),
}))

describe('status bar shows only measured values', () => {
  it('renders nothing but the frame when there is nothing to report', () => {
    render(<StatusBar />)
    expect(screen.getByTestId('status-bar')).toBeTruthy()
    expect(screen.queryByTestId('status-connection')).toBeNull()
    expect(screen.queryByTestId('status-size')).toBeNull()
    expect(screen.queryByTestId('status-transfers')).toBeNull()
  })

  it('does not claim a connection state it was not given', () => {
    // The single most important absence: no status prop means no indicator, not a
    // default green dot.
    render(<StatusBar cols={120} rows={30} />)
    expect(screen.queryByTestId('status-connection')).toBeNull()
  })

  it('reports the size the terminal actually reported', () => {
    render(<StatusBar cols={120} rows={30} />)
    expect(screen.getByTestId('status-size').textContent).toBe('120×30')
  })

  it('refuses a zero or non-integer size', () => {
    // xterm reports 0 before the first fit. Rendering "0×0" would be a number the
    // PTY never saw.
    for (const [cols, rows] of [
      [0, 0],
      [0, 30],
      [Number.NaN, 30],
      [120.5, 30],
    ]) {
      const { unmount } = render(<StatusBar cols={cols} rows={rows} />)
      expect(screen.queryByTestId('status-size')).toBeNull()
      unmount()
    }
  })

  it('shows a connection state only when given one', () => {
    render(<StatusBar status="connected" />)
    const node = screen.getByTestId('status-connection')
    expect(node.textContent).toContain('connected')
  })

  it('hides the transfer count at zero', () => {
    // A permanent "0 transfers" is noise; the badge only matters while something
    // is moving.
    const { unmount } = render(<StatusBar transfers={0} />)
    expect(screen.queryByTestId('status-transfers')).toBeNull()
    unmount()

    render(<StatusBar transfers={2} />)
    expect(screen.getByTestId('status-transfers').textContent).toBe('2 transfers')
  })

  it('never renders a field for encoding or shell', () => {
    // Neither is a verified fact anywhere in the app today. If one is added, it
    // has to come with a real source — this assertion is the reminder.
    render(<StatusBar status="connected" cols={80} rows={24} transfers={1} />)
    const text = screen.getByTestId('status-bar').textContent ?? ''
    expect(text).not.toMatch(/utf-?8/i)
    expect(text).not.toMatch(/zsh|bash/i)
  })
})
