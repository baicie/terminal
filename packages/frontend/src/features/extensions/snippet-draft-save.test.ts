// Capturing a selection as a draft has to lead somewhere.
//
// ## The defect this pins
//
// `captureSelection` stores the text in `pendingDraft` and the dock renders it in a
// `<pre>`. Nothing read that value. So the user could select terminal text, ask the dock
// to capture it, see it appear — and then do nothing with it. The feature looked
// finished from every test that existed, because every test stopped at "the draft is in
// state".
//
// ## What the save must not do
//
// The extension's own contract says it never stores a row: "capturing here must not
// create a row… saving is the existing Snippets view's job, where the user names it and
// confirms". Saving therefore takes a name from the user and writes through the
// existing `createSnippet` service — not through the extension's capability bucket, and
// not silently.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  draftToSnippet,
  draftSaveProblem,
  type DraftSaveInput,
} from './snippet-draft-save'

const VALID = {
  text: 'kubectl get pods -A',
  name: 'List all pods',
}

describe('a draft becomes a snippet only with a name', () => {
  it('refuses a blank name rather than inventing one', () => {
    // A generated name ("Snippet 1") would be the app making a decision the user did
    // not: the next snippet is then also "Snippet 1", and the list becomes unsearchable.
    for (const name of ['', '   ', '\n\t']) {
      expect(draftSaveProblem({ text: VALID.text, name })).not.toBeNull()
    }
  })

  it('refuses an empty draft', () => {
    expect(draftSaveProblem({ text: '', name: VALID.name })).not.toBeNull()
    expect(draftSaveProblem({ text: '   ', name: VALID.name })).not.toBeNull()
  })

  it('accepts a named, non-empty draft', () => {
    expect(draftSaveProblem(VALID)).toBeNull()
  })

  it('trims the name rather than storing the surrounding whitespace', () => {
    // A name of "  List all pods  " is indistinguishable from the trimmed one in every
    // list, and the spaces only show up when something compares or exports it.
    const snippet = draftToSnippet({ text: VALID.text, name: '  List all pods  ' }, 'id-1')
    expect(snippet.name).toBe('List all pods')
  })
})

describe('the draft is written through the existing snippet service', () => {
  it('builds a record the snippets table accepts', () => {
    const snippet = draftToSnippet(VALID, 'id-1')
    expect(snippet).toEqual({
      id: 'id-1',
      name: 'List all pods',
      // The whole draft is the script: the user selected text, and silently trimming
      // it to the first line would store something different from what they saw.
      script: 'kubectl get pods -A',
    })
  })

  it('keeps a multi-line selection intact', () => {
    const script = 'kubectl get pods\nkubectl get svc\nkubectl get nodes'
    expect(draftToSnippet({ text: script, name: 'cluster' }, 'id-2').script).toBe(script)
  })

  it('preserves leading indentation, which is often the point', () => {
    // A YAML or Python snippet stripped of indentation is not the same snippet.
    const script = 'app:\n  name: web\n  port: 80'
    expect(draftToSnippet({ text: script, name: 'manifest' }, 'id-3').script).toBe(script)
  })
})

describe('a failed write is reported, not swallowed', () => {
  let created: DraftSaveInput[] = []

  beforeEach(() => {
    created = []
  })

  it('reports success only after the write resolves', async () => {
    const save = vi.fn(async () => undefined)
    const { saveDraftAsSnippet } = await import('./snippet-draft-save')
    const result = await saveDraftAsSnippet(VALID, { createSnippet: save, nextId: () => 'id-1' })
    expect(result.ok).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    created.push(VALID)
  })

  it('reports a rejected write with its reason', async () => {
    const { saveDraftAsSnippet } = await import('./snippet-draft-save')
    const result = await saveDraftAsSnippet(VALID, {
      createSnippet: async () => {
        throw new Error('database is locked')
      },
      nextId: () => 'id-1',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/locked/i)
  })

  it('does not write at all when the input is invalid', async () => {
    // Validation happens before the write so a blank name cannot reach SQLite and leave
    // a row the user cannot find.
    const save = vi.fn(async () => undefined)
    const { saveDraftAsSnippet } = await import('./snippet-draft-save')
    const result = await saveDraftAsSnippet({ text: VALID.text, name: '' }, {
      createSnippet: save,
      nextId: () => 'id-1',
    })
    expect(result.ok).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })
})
