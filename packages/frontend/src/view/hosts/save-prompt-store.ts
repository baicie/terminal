/**
 * The save prompt the app is currently showing.
 *
 * A store rather than local state because the prompt is rendered by the Hosts view while
 * the condition that raises it is observed by the terminal container — two trees that
 * share no parent close enough for props. The value is a host and a secret; the secret
 * is dropped on either answer, so this store never holds one for longer than the question
 * is open.
 *
 * Only one prompt at a time: a second connection that authenticates while the first
 * question is still open replaces it rather than queueing. Two simultaneous "save this?"
 * dialogs would be one more than a user can answer.
 */

import { create } from 'zustand'
import type { PendingSave } from './pending-save'

interface SavePromptState {
  pending: PendingSave | null
  offer: (entry: PendingSave) => void
  dismiss: () => void
}

export const useSavePromptStore = create<SavePromptState>(set => ({
  pending: null,
  offer: entry => set({ pending: entry }),
  dismiss: () => set({ pending: null }),
}))

/** Test-only: a suite starts with no prompt on screen. */
export function __resetSavePromptForTests(): void {
  useSavePromptStore.setState({ pending: null })
}
