// TN-SFTP-02 — the file row in a narrow pane.
//
// Two things a user needs from a 300px dock that the old row did not give:
//
//   1. the name truncates to the space available rather than to a `120px` constant
//      that was chosen when the dock was assumed wide;
//   2. the full name is still knowable — a truncated `report-final.pdf` and
//      `report-final.psd` are indistinguishable, and one of them is about to be
//      deleted.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FileItem } from '@/service/ssh'
import { FilePaneRow } from './file-pane-row'

function file(overrides: Partial<FileItem> = {}): FileItem {
  return {
    name: 'report-2026-11-final.pdf',
    path: '/srv/report-2026-11-final.pdf',
    is_directory: false,
    size: 1024,
    modified_time: 1_700_000_000,
    permissions: '-rw-r--r--',
    ...overrides,
  } as FileItem
}

function renderRow(overrides: Partial<Parameters<typeof FilePaneRow>[0]> = {}) {
  return render(
    <table>
      <tbody>
        <FilePaneRow
          file={file()}
          type="remote"
          sessionId="s1"
          selected={false}
          focused={false}
          onSelect={vi.fn()}
          onFocus={vi.fn()}
          onDoubleClick={vi.fn()}
          onDownload={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          {...overrides}
        />
      </tbody>
    </table>,
  )
}

describe('FilePaneRow', () => {
  it('puts the full name in a title attribute', () => {
    renderRow()
    const name = screen.getByTitle('report-2026-11-final.pdf')
    expect(name.textContent).toBe('report-2026-11-final.pdf')
  })

  it('truncates without a hardcoded max width', () => {
    // `max-w-[120px] sm:max-w-none` was the defect: 120px is narrower than the dock
    // pane can be, and the `sm` step never fires inside a 300px dock in a 1440px
    // window. The cell decides now, so the only class is `truncate`.
    renderRow()
    const name = screen.getByTitle('report-2026-11-final.pdf')
    expect(name.className).toBe('truncate')
  })

  it('is reachable by keyboard', () => {
    renderRow()
    const row = screen.getByTestId('file-row')
    expect(row.getAttribute('tabindex')).toBe('0')
  })

  it('labels the actions button for screen readers', () => {
    // The trigger is `opacity-0` until hover; without a label a keyboard or screen
    // reader user has an unlabelled button that only appears on focus.
    renderRow()
    const trigger = screen.getByLabelText('File actions')
    expect(trigger).toBeTruthy()
  })

  it('shows the actions trigger on keyboard focus, not only on hover', () => {
    renderRow()
    const trigger = screen.getByLabelText('File actions')
    // `group-hover` alone made the menu unreachable without a mouse.
    expect(trigger.className).toContain('focus-visible:opacity-100')
  })

  it('does not offer file actions for a local row', () => {
    renderRow({ type: 'local', sessionId: null })
    expect(screen.queryByLabelText('File actions')).toBeNull()
  })

  it('highlights the focused row', () => {
    renderRow({ focused: true })
    expect(screen.getByTestId('file-row').className).toContain('bg-primary/10')
  })
})
