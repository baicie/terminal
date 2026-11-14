// Issue #55 — a focusable row the keyboard cannot operate.
//
// ## The gap
//
// `FilePaneRow` set `tabIndex={0}` and wired `onFocus`, so Tab reached every row —
// and then stopped. There was no `onKeyDown`, so Enter and Space did nothing. A
// keyboard user could move the highlight through a file list and could not select a
// file, open a directory, or reach the row's action menu.
//
// ## What is being defined here
//
// The row already has two mouse gestures; the keyboard gets the same two:
//
//   * **Space** selects, exactly like a single click (`onSelect`), because that is
//     what a click does and Space is the standard "activate this control" key.
//   * **Enter** does what a double click does — for this table that is "open", which
//     for a directory means navigate. For a file it is a no-op, matching the mouse:
//     double-clicking a file does nothing today.
//
// Keys that belong to something else must pass through untouched: arrows, Tab,
// Home/End, and any key pressed while focus is inside the action menu. Swallowing
// those would break the table's own navigation and the menu's own keyboard handling.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FileItem } from '@/service/ssh'
import { FilePaneRow } from './file-pane-row'

function file(overrides: Partial<FileItem> = {}): FileItem {
  return {
    name: 'report.pdf',
    path: '/srv/report.pdf',
    is_directory: false,
    size: 1024,
    modified_time: 1_700_000_000,
    permissions: '-rw-r--r--',
    ...overrides,
  } as FileItem
}

function renderRow(overrides: Partial<Parameters<typeof FilePaneRow>[0]> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onFocus: vi.fn(),
    onDoubleClick: vi.fn(),
    onDownload: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  }
  const result = render(
    <table>
      <tbody>
        <FilePaneRow
          file={file()}
          type="remote"
          sessionId="s1"
          selected={false}
          focused={false}
          {...handlers}
          {...overrides}
        />
      </tbody>
    </table>,
  )
  return { ...result, handlers }
}

describe('the row is operable from the keyboard', () => {
  it('Space selects the row, like a click', () => {
    const { handlers } = renderRow()
    fireEvent.keyDown(screen.getByTestId('file-row'), { key: ' ' })
    expect(handlers.onSelect).toHaveBeenCalledTimes(1)
    expect(handlers.onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'report.pdf' }))
  })

  it('Enter opens, which for this table is the double-click action', () => {
    const { handlers } = renderRow()
    fireEvent.keyDown(screen.getByTestId('file-row'), { key: 'Enter' })
    expect(handlers.onDoubleClick).toHaveBeenCalledTimes(1)
  })

  it('Enter on a directory asks to open it', () => {
    // The pane decides what "open" means; the row only has to report the gesture.
    const { handlers } = renderRow({
      file: file({ name: 'logs', path: '/srv/logs', is_directory: true }),
    })
    fireEvent.keyDown(screen.getByTestId('file-row'), { key: 'Enter' })
    expect(handlers.onDoubleClick).toHaveBeenCalledWith(
      expect.objectContaining({ is_directory: true }),
    )
  })

  it('does not select twice when Enter is pressed (no synthetic click)', () => {
    // `Enter` on a focusable element can also produce a click in some browsers;
    // the row must not select *and* open from one key press.
    const { handlers } = renderRow()
    fireEvent.keyDown(screen.getByTestId('file-row'), { key: 'Enter' })
    expect(handlers.onSelect).not.toHaveBeenCalled()
    expect(handlers.onDoubleClick).toHaveBeenCalledTimes(1)
  })

  it('leaves arrow keys to the table', () => {
    const { handlers } = renderRow()
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab']) {
      fireEvent.keyDown(screen.getByTestId('file-row'), { key })
    }
    expect(handlers.onSelect).not.toHaveBeenCalled()
    expect(handlers.onDoubleClick).not.toHaveBeenCalled()
  })

  it('ignores a key press that came from inside the action menu', () => {
    // The menu has its own Enter/Space handling. Bubbling here would open the file
    // and close the menu at the same time.
    const { handlers } = renderRow()
    const trigger = screen.getByLabelText('File actions')
    fireEvent.keyDown(trigger, { key: 'Enter', bubbles: true })
    expect(handlers.onDoubleClick).not.toHaveBeenCalled()
    expect(handlers.onSelect).not.toHaveBeenCalled()
  })

  it('a modifier key does not turn into an action', () => {
    // Cmd/Ctrl+Enter is a shortcut elsewhere; it must not fall through to "open".
    const { handlers } = renderRow()
    fireEvent.keyDown(screen.getByTestId('file-row'), { key: 'Enter', metaKey: true })
    fireEvent.keyDown(screen.getByTestId('file-row'), { key: 'Enter', ctrlKey: true })
    expect(handlers.onDoubleClick).not.toHaveBeenCalled()
  })

  it('reports its selection through aria-selected', () => {
    const { rerender } = renderRow()
    expect(screen.getByTestId('file-row').getAttribute('aria-selected')).toBe('false')

    rerender(
      <table>
        <tbody>
          <FilePaneRow
            file={file()}
            type="remote"
            sessionId="s1"
            selected
            focused={false}
            onSelect={vi.fn()}
            onFocus={vi.fn()}
            onDoubleClick={vi.fn()}
            onRename={vi.fn()}
            onDelete={vi.fn()}
          />
        </tbody>
      </table>,
    )
    expect(screen.getByTestId('file-row').getAttribute('aria-selected')).toBe('true')
  })
})

describe('the mouse still works', () => {
  it('a click still selects', () => {
    const { handlers } = renderRow()
    fireEvent.click(screen.getByTestId('file-row'))
    expect(handlers.onSelect).toHaveBeenCalledTimes(1)
  })

  it('a double click still opens', () => {
    const { handlers } = renderRow()
    fireEvent.doubleClick(screen.getByTestId('file-row'))
    expect(handlers.onDoubleClick).toHaveBeenCalledTimes(1)
  })

  it('the row stays focusable', () => {
    renderRow()
    expect(screen.getByTestId('file-row').getAttribute('tabindex')).toBe('0')
  })
})
