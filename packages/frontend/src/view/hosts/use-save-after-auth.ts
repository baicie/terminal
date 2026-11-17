/**
 * Showing the save prompt when — and only when — a credential has authenticated.
 *
 * ## The two halves
 *
 * `arm` runs where the connection starts: it records the host and the secret the user
 * typed, keyed by the tab that will try it. `settleOnConnectionStatus` runs where the
 * session reports its status, which is the first moment anyone knows whether that secret
 * actually worked. They are in different component trees, so the value travels through a
 * module-level registry rather than through props — the same problem
 * `temporary-terminal-profiles.ts` solves for the credential itself.
 *
 * ## Why the decision is a pure function used from both sides
 *
 * "May the user be asked to save this?" has one correct answer and several wrong ones
 * (ask before the connection, ask on a failed one, ask twice). Keeping it in
 * `canOfferSaveAfterAuth` means the question is answered in one place with its own tests.
 */

import { useCallback } from 'react'
import type { Host } from '@/types'
import type { OneTimeSecret } from '@/features/terminal/services/one-time-credential'
import {
  canOfferSaveAfterAuth,
  saveOneTimeSecretForHost,
  type SaveResult,
} from './save-after-auth'
import {
  armSaveAfterAuth,
  disarmSaveAfterAuth,
  takeSaveAfterAuth,
  type PendingSave,
} from './pending-save'
import { scrubTemporaryTerminalProfileSecrets } from '@/features/terminal/services/temporary-terminal-profiles'
import { useSavePromptStore } from './save-prompt-store'

/**
 * Stop holding the secret once the question is answered.
 *
 * Two things go, and both matter:
 *
 * - the pending entry, so a later settle cannot re-ask;
 * - the secrets on the process-local profile, which the tab keeps for reconnects. The
 *   tab must keep the *profile* — `TerminalContainer` reads it to reconnect — but the
 *   plaintext has no business outliving the answer. A reconnect after this asks again,
 *   which is what "not stored" should mean.
 */
function release(entry: PendingSave): void {
  disarmSaveAfterAuth(entry.tabId)
  scrubTemporaryTerminalProfileSecrets(entry.profileId)
}

/** What the dialog needs: the answer handlers for the entry it is showing. */
export interface SaveAfterAuthActions {
  save: () => Promise<SaveResult>
  dismiss: () => void
}

/**
 * The handlers for the prompt currently on screen.
 *
 * The prompt's *visibility* comes from `useSavePromptStore`, which the terminal
 * container writes to; this only answers it.
 */
export function useSaveAfterAuth(deps: {
  updateHost: (id: string, updates: Partial<Host>) => Promise<void>
}): SaveAfterAuthActions {
  const pending = useSavePromptStore(state => state.pending)
  const dismissPrompt = useSavePromptStore(state => state.dismiss)

  const save = useCallback(async (): Promise<SaveResult> => {
    if (!pending) return { ok: true }
    const result = await saveOneTimeSecretForHost(pending, { updateHost: deps.updateHost })
    // Dropped on both outcomes: a failed save is a Vault problem, and retrying it is a
    // Settings action, not a reason to keep the plaintext in memory.
    release(pending)
    dismissPrompt()
    return result
  }, [pending, deps.updateHost, dismissPrompt])

  const dismiss = useCallback(() => {
    if (pending) release(pending)
    dismissPrompt()
  }, [pending, dismissPrompt])

  return { save, dismiss }
}

/**
 * Record the secret a tab is about to try.
 *
 * Called from the connect branch that registers the one-time profile. Nothing is shown
 * here: a prompt at this point would be asking about a credential that has not been
 * accepted yet.
 */
export function armSaveAfterAuthForTab(
  tabId: string,
  host: Host,
  secret: OneTimeSecret,
  profileId: string,
): void {
  armSaveAfterAuth(tabId, host, secret, profileId)
}

/**
 * React to a tab's connection status.
 *
 * This is the whole trigger. `connected` is the first moment the SSH handshake proved
 * the secret; a rejected password never produces it, which is why a save can never be
 * offered for one.
 *
 * Returns the entry to show, or null.
 */
export function settleOnConnectionStatus(
  tabId: string,
  connected: boolean,
): PendingSave | null {
  if (!connected) {
    // A failed attempt drops the offer rather than holding it for a retry: the retry
    // will carry whatever password the user types next, and that is a different
    // secret with its own consent.
    disarmSaveAfterAuth(tabId)
    return null
  }
  const candidate = takeSaveAfterAuth(tabId)
  if (!candidate) return null
  if (!canOfferSaveAfterAuth({ connected: true, secret: candidate.secret, host: candidate.host })) {
    return null
  }
  return candidate
}
