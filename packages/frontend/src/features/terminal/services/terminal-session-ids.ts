/**
 * The backend session id, per tab.
 *
 * ## Why this exists
 *
 * Two different identifiers are both called "session id" in this codebase:
 *
 * - the **tab id**, a frontend identifier the session manager uses as its map key;
 * - the **backend session id**, the value `session_create_*` returns and the only one
 *   `session_write` / `session_exec` / `session_close` accept.
 *
 * Components on the terminal side already hold the second one — `useTerminal` receives
 * it in every snapshot. Components beside the terminal do not: `RightPanel` is a
 * sibling of the terminal layer, not a descendant, so it had nothing to read and used
 * `activeTab.id`.
 *
 * That produced an exec against an id the backend has never heard of. The failure
 * surfaced as a generic probe error, with nothing in it saying the id was the wrong
 * *kind*, which is why it survived several rounds of component tests: those tests pass
 * whichever id the test author supplies, so both kinds look identical to them.
 *
 * ## Why a module-level map rather than a store field
 *
 * The same reason `pending-save.ts` and `temporary-terminal-profiles.ts` are maps: the
 * writer (`TerminalContainer`) and the reader (`RightPanel`) share no parent close
 * enough for props, and the value is ephemeral — it must die with the session, not be
 * persisted or restored.
 */

type Listener = () => void

const sessionIds = new Map<string, string>()
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A broken subscriber must not stop the others, and must not propagate into the
      // session-state publish path that calls this.
    }
  }
}

/**
 * Record the backend session id for a tab, or clear it.
 *
 * `null` is a real value here: a tab whose session ended has no backend id, and keeping
 * the last one would point the Inspector at a session the backend already dropped.
 */
export function publishTerminalSessionId(tabId: string, sessionId: string | null): void {
  const previous = sessionIds.get(tabId) ?? null
  if (sessionId === null) {
    if (previous === null) return
    sessionIds.delete(tabId)
  } else {
    if (previous === sessionId) return
    sessionIds.set(tabId, sessionId)
  }
  notify()
}

/**
 * The backend session id for a tab, or null when it has none.
 *
 * Null, not the tab id. A caller that needs "is there a session?" gets an honest
 * answer, and one that would have used the tab id as a fallback has nothing to fall
 * back to.
 */
export function sessionIdForTab(tabId: string): string | null {
  return sessionIds.get(tabId) ?? null
}

/** Subscribe to changes. Returns an unsubscribe. */
export function subscribeTerminalSessionIds(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only: a suite starts with no ids recorded. */
export function __resetTerminalSessionIdsForTests(): void {
  sessionIds.clear()
  listeners.clear()
}
