// The remote pane's keyboard shortcuts.
//
// ## Why F2 exists
//
// `Delete` had a shortcut here from the start; **rename had none**. Its only entry was
// the hover-only `file-row-actions` dropdown (`file-pane-row.tsx`), and that menu
// stopped a real-GUI acceptance case for three CI rounds (30 minutes each) on macOS,
// Linux and Windows alike.
//
// Whether or not a synthetic event can open a Radix `DropdownMenuTrigger` is a
// question about the test harness. "The only way to rename a file is to hover it and
// click a button that appears" is a question about the product, and the answer is bad
// for anyone on a keyboard. F2 is the convention every file manager uses, so this is
// not a test hook — it is the missing route.
//
// These cases pin both: that the shortcut works, and that it is wired to the *right*
// file rather than whichever row happens to be focused.

import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePane } from './file-pane'
import type { FileItem } from '@/service/ssh'

function file(overrides: Partial<FileItem> = {}): FileItem {
  return {
    name: 'notes.txt',
    path: '/root/notes.txt',
    size: 12,
    is_directory: false,
    // The field the row reads is `modified_time`; an unset one renders `—`, which is
    // also the shape a server reports for an unknown mtime.
    modified_time: null,
    permissions: '-rw-r--r--',
    ...overrides,
  }
}

/**
 * A mounted remote pane with one file, and a spy on what the shortcuts call.
 *
 * `sessionId` is required: the shortcuts and the actions menu are both gated on it
 * (`file-pane.tsx`), so a test that omitted it would drive a pane the product never
 * renders for a connected host.
 */
function mountRemote(files: FileItem[] = [file()]) {
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const onSelectFile = vi.fn()
  const { container } = render(
    <FilePane
      type="remote"
      files={files}
      currentPath="/root"
      pathHistory={['/root']}
      pathHistoryIndex={0}
      loading={false}
      selectedFile={files[0] ?? null}
      sessionId="sftp-session-1"
      onNavigate={vi.fn()}
      onBack={vi.fn()}
      onForward={vi.fn()}
      onRefresh={vi.fn()}
      onSelectFile={onSelectFile}
      onDelete={onDelete}
      onRename={onRename}
      onMkdir={vi.fn()}
      onDownload={vi.fn()}
    />,
  )
  return { container, onRename, onDelete }
}

/** Dispatch a real `keydown` on `window`, which is where the pane listens. */
function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

/*
 * `FilePane` calls `useBreakpointMax`, which reads `window.matchMedia` — not
 * implemented by jsdom. "Never matches" means "not mobile", which is what these cases
 * want: the shortcut handler, not the viewport, is under test.
 */
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the remote pane keyboard shortcuts', () => {
  it('F2 renames the selected file', () => {
    const { onRename } = mountRemote()

    press('F2')

    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.txt' }))
  })

  it('Delete deletes the selected file', () => {
    // The pre-existing shortcut, pinned so a refactor of the shared handler cannot
    // drop it while adding F2.
    const { onDelete } = mountRemote()

    press('Delete')

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.txt' }))
  })

  it('acts on the selected file, not merely the first one', () => {
    /*
     * The failure this guards: a handler that renames `files[0]` would pass a
     * single-file test and corrupt the wrong file in a real directory.
     */
    const first = file({ name: 'a.txt', path: '/root/a.txt' })
    const second = file({ name: 'b.txt', path: '/root/b.txt' })
    const onRename = vi.fn()

    render(
      <FilePane
        type="remote"
        files={[first, second]}
        currentPath="/root"
        pathHistory={['/root']}
        pathHistoryIndex={0}
        loading={false}
        selectedFile={second}
        sessionId="sftp-session-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onSelectFile={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
        onMkdir={vi.fn()}
        onDownload={vi.fn()}
      />,
    )

    press('F2')

    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.txt' }))
    expect(onRename).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt' }))
  })

  it('does nothing without a remote session', () => {
    /*
     * The shortcuts are gated on `sessionId` because without one there is nothing to
     * rename over SFTP. A handler that fired anyway would open a dialog that cannot
     * complete — the "looks wired, does nothing" shape.
     */
    const onRename = vi.fn()
    render(
      <FilePane
        type="remote"
        files={[file()]}
        currentPath="/root"
        pathHistory={['/root']}
        pathHistoryIndex={0}
        loading={false}
        selectedFile={file()}
        sessionId={null}
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onSelectFile={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
        onMkdir={vi.fn()}
        onDownload={vi.fn()}
      />,
    )

    press('F2')

    expect(onRename).not.toHaveBeenCalled()
  })

  it('does nothing with no selection', () => {
    const onRename = vi.fn()
    render(
      <FilePane
        type="remote"
        files={[file()]}
        currentPath="/root"
        pathHistory={['/root']}
        pathHistoryIndex={0}
        loading={false}
        selectedFile={null}
        sessionId="sftp-session-1"
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onSelectFile={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
        onMkdir={vi.fn()}
        onDownload={vi.fn()}
      />,
    )

    press('F2')

    expect(onRename).not.toHaveBeenCalled()
  })

  it('leaves an already-handled F2 alone', () => {
    // `!e.defaultPrevented` is in the handler; a dialog that consumed the key must not
    // also trigger a second rename.
    const { onRename } = mountRemote()

    const event = new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)

    expect(onRename).not.toHaveBeenCalled()
  })
})
