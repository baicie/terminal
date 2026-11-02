const SYNC_CURSOR_KEY_PREFIX = 'terminal.team.syncCursor'
/** Cursor generation of this client; another generation never collides. */
const SYNC_CURSOR_PROTOCOL_VERSION = '2'
/** The single global key of earlier releases: discarded, never adopted. */
const LEGACY_SYNC_CURSOR_KEY = SYNC_CURSOR_KEY_PREFIX
/**
 * The cursor is opaque and server issued: stored verbatim, replayed verbatim,
 * never parsed into numbers (docs/phase8/sync-protocol.md §5).
 */
export const CURSOR_PATTERN = /^\d{1,20}(?:\.\d{1,20})*$/

/** Process-local fallback for hosts without localStorage (node, memory only). */
const memoryCursors = new Map<string, string>()

/**
 * A cursor's scope is one server and one identity - never one team. The server
 * decides the team scope on every request (the caller's complete membership set,
 * docs/phase8/sync-protocol.md §3.8), so a per-team key would claim an isolation
 * the cursor does not have: two keys of the same identity could drift to two
 * positions, and the client could not tell which one its data came from.
 */
export interface SyncCursorScope {
  endpoint: string
  userId: string
}

export function syncCursorStorageKey(scope: SyncCursorScope): string {
  const endpoint = scope.endpoint.trim().replace(/\/+$/, '')
  return [
    SYNC_CURSOR_KEY_PREFIX,
    `v${SYNC_CURSOR_PROTOCOL_VERSION}`,
    encodeURIComponent(endpoint),
    encodeURIComponent(scope.userId),
  ].join(':')
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * A global cursor names no server and no identity, so it cannot be attributed to
 * this scope: porting it would let one namespace resume with another's progress,
 * and a skipped window is invisible while a full resnapshot is not. It is
 * therefore dropped and the cursor-less request is answered with the whole
 * window (docs/phase8/sync-protocol.md §5, "无法证明来源时应重新完整同步").
 */
function dropLegacyCursor(store: Storage): void {
  if (store.getItem(LEGACY_SYNC_CURSOR_KEY) !== null) {
    store.removeItem(LEGACY_SYNC_CURSOR_KEY)
  }
}

export function readStoredCursor(scope: SyncCursorScope): string | null {
  const key = syncCursorStorageKey(scope)
  const store = storage()
  if (!store) return memoryCursors.get(key) ?? null
  dropLegacyCursor(store)
  const raw = store.getItem(key)
  if (raw === null) return null
  if (CURSOR_PATTERN.test(raw)) return raw
  // Unusable: drop it so the server answers with a resnapshot, never a guess.
  store.removeItem(key)
  return null
}

export function storeCursor(scope: SyncCursorScope, cursor: string): void {
  const key = syncCursorStorageKey(scope)
  const store = storage()
  if (!store) {
    memoryCursors.set(key, cursor)
    return
  }
  store.setItem(key, cursor)
}

/** Forgets this scope's position, so the next round asks for a full window. */
export function dropStoredCursor(scope: SyncCursorScope): void {
  const key = syncCursorStorageKey(scope)
  const store = storage()
  if (!store) {
    memoryCursors.delete(key)
    return
  }
  store.removeItem(key)
}
