// The dock's draft panel: the part that was missing.
//
// The extension's own tests stop at "the draft is in state". That is true and
// insufficient — the defect was that nothing consumed it, and no test looked at the
// dock's rendered output. This drives the component: the text appears, the field takes a
// name, and the save either writes and refreshes or reports why it did not.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import { SnippetDock } from './snippet-dock-view'
import type { SnippetDockHandle, SnippetDockState } from '@/features/extensions/snippet-dock-extension'

function handleWith(state: SnippetDockState, overrides: Partial<SnippetDockHandle> = {}): SnippetDockHandle {
  const listeners = new Set<() => void>()
  let current = state
  return {
    state: () => current,
    refresh: vi.fn(async () => undefined),
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    captureSelection: vi.fn(async () => true),
    discardDraft: vi.fn(() => {
      current = { ...current, pendingDraft: null }
      for (const listener of listeners) listener()
    }),
    dispose: vi.fn(() => {
      listeners.clear()
    }),
    disposed: false,
    ...overrides,
  }
}

const EMPTY: SnippetDockState = { snippets: [], error: null, pendingDraft: null }

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('a captured draft can be kept from the dock', () => {
  it('shows the captured text and a name field', () => {
    // The old dock showed the text with no way forward, so the user's only option was
    // to leave and hope the Snippets page knew about it. It did not.
    const handle = handleWith({
      ...EMPTY,
      pendingDraft: { text: 'kubectl get pods', selectionId: 'sel-1' },
    })
    render(<SnippetDock handle={handle} onClose={() => undefined} />)
    expect(screen.getByTestId('snippet-draft').textContent).toContain('kubectl get pods')
    expect(screen.getByLabelText('Snippet name')).toBeTruthy()
  })

  it('refuses to save without a name and says why', async () => {
    const handle = handleWith({
      ...EMPTY,
      pendingDraft: { text: 'ls', selectionId: 'sel-1' },
    })
    render(<SnippetDock handle={handle} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/name/i))
  })

  it('keeps the draft on screen when the write fails', async () => {
    // The draft is the only copy of the user's selection. Discarding it because SQLite
    // said no would mean selecting the text again.
    const handle = handleWith({
      ...EMPTY,
      pendingDraft: { text: 'ls', selectionId: 'sel-1' },
    })
    const { createSnippet } = await import('@/service/database/snippets')
    const spy = vi.spyOn(await import('@/service/database/snippets'), 'createSnippet')
    void createSnippet
    spy.mockRejectedValueOnce(new Error('database is locked'))

    render(<SnippetDock handle={handle} onClose={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Snippet name'), { target: { value: 'List' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/locked/i))
    expect(screen.getByTestId('snippet-draft')).toBeTruthy()
  })

  it('reloads the list after a successful save', async () => {
    // A save that succeeds while the dock keeps showing the old set reads as "it did not
    // save" — the row is there, the user just cannot see it.
    const refresh = vi.fn(async () => undefined)
    const handle = handleWith(
      { ...EMPTY, pendingDraft: { text: 'ls', selectionId: 'sel-1' } },
      { refresh },
    )
    const spy = vi.spyOn(await import('@/service/database/snippets'), 'createSnippet')
    spy.mockResolvedValueOnce(undefined)

    render(<SnippetDock handle={handle} onClose={() => undefined} />)
    fireEvent.change(screen.getByLabelText('Snippet name'), { target: { value: 'List' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('discards through the handle', async () => {
    const handle = handleWith({
      ...EMPTY,
      pendingDraft: { text: 'ls', selectionId: 'sel-1' },
    })
    render(<SnippetDock handle={handle} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(handle.discardDraft).toHaveBeenCalled()
  })
})

describe('an inactive extension says so', () => {
  it('does not render a draft panel or a list', () => {
    // Null handle is the documented "not enabled" state; it must not look like an empty
    // snippet list, which would read as "you have no snippets".
    render(<SnippetDock handle={null} onClose={() => undefined} />)
    expect(screen.queryByTestId('snippet-draft')).toBeNull()
    expect(screen.getByText(/turned off/i)).toBeTruthy()
  })
})
