/**
 * Turning a captured draft into a saved snippet.
 *
 * ## Why this module exists
 *
 * The Snippet Dock can capture the terminal selection as a draft. Until this existed,
 * nothing consumed that draft: the dock rendered it in a `<pre>` and stopped. The user
 * could capture text, see it, and have no way to keep it — a feature that every existing
 * test called complete because every test stopped at "the draft is in state".
 *
 * ## What it deliberately is not
 *
 * - **It does not run through the extension.** The extension's contract says it never
 *   stores a row — "saving is the existing Snippets view's job, where the user names it
 *   and confirms". So this is called by the dock's UI, not by `SnippetDockHandle`, and
 *   it writes with the same `createSnippet` the Snippets view uses. A second write path
 *   is how the two would come to disagree about what a snippet is.
 * - **It does not name anything.** A generated name ("Snippet 1") is the app deciding
 *   what the user's snippet is called, and the second one is then also "Snippet 1".
 * - **It does not trim the script.** The selection is the content. Trimming to the first
 *   line, or stripping indentation, stores something other than what the user saw —
 *   for YAML or Python that changes the meaning.
 */

import { createSnippet } from '@/service/database/snippets'
import type { SnippetRecord } from '@/service/database/types'

/** What the dock has: the selected text, and what the user wants to call it. */
export interface DraftSaveInput {
  text: string
  name: string
}

/**
 * Why this draft cannot be saved, or null when it can.
 *
 * Checked before the write so a blank name never reaches SQLite. A row with an empty
 * name is not visible in any list and cannot be found to fix.
 */
export function draftSaveProblem(input: DraftSaveInput): string | null {
  if (input.text.trim().length === 0) return 'There is nothing to save.'
  if (input.name.trim().length === 0) return 'Give the snippet a name.'
  return null
}

/**
 * The row to insert.
 *
 * The name is trimmed — surrounding whitespace is invisible in every list and only
 * shows up when something compares or exports the value. The script is not: it is the
 * user's selection, verbatim.
 */
export function draftToSnippet(input: DraftSaveInput, id: string): SnippetRecord {
  return {
    id,
    name: input.name.trim(),
    script: input.text,
  }
}

export type DraftSaveResult = { ok: true, snippet: SnippetRecord } | { ok: false, message: string }

/** The write, injected so a test does not need SQLite. */
export interface DraftSaveDeps {
  createSnippet: (snippet: SnippetRecord) => Promise<void>
  nextId: () => string
}

/**
 * Store the draft as a snippet, or report why it was not stored.
 *
 * A failure is returned rather than thrown so the dock can keep the draft on screen: the
 * user's selection is the only copy of that text, and losing it because a write failed
 * would mean selecting it again.
 */
export async function saveDraftAsSnippet(
  input: DraftSaveInput,
  deps: DraftSaveDeps = { createSnippet, nextId: defaultId },
): Promise<DraftSaveResult> {
  const problem = draftSaveProblem(input)
  if (problem) return { ok: false, message: problem }
  const snippet = draftToSnippet(input, deps.nextId())
  try {
    await deps.createSnippet(snippet)
    return { ok: true, snippet }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Ids in the same shape the rest of the snippet code uses. */
function defaultId(): string {
  return `snippet-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}
