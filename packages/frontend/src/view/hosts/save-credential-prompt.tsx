/**
 * The save prompt, mounted where the terminal lives.
 *
 * It renders `SaveCredentialDialog` against the store, so the question survives the user
 * navigating away from Hosts — which is the normal case, because connecting navigates to
 * the terminal tab. Putting this in the Hosts view would mean the prompt exists only on a
 * route the user has already left.
 */

import { useSavePromptStore } from './save-prompt-store'
import { SaveCredentialDialog } from './save-credential-dialog'
import { useSaveAfterAuth } from './use-save-after-auth'
import { updateHost } from '@/service/database'

export function SaveCredentialPrompt() {
  const pending = useSavePromptStore(state => state.pending)
  const { save, dismiss } = useSaveAfterAuth({ updateHost })

  return (
    <SaveCredentialDialog
      host={pending?.host ?? null}
      onSave={save}
      onDismiss={dismiss}
    />
  )
}
