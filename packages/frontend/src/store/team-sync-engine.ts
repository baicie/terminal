import {
  addSharedHost,
  addSharedSnippet,
  removeSharedHost,
  removeSharedSnippet,
} from '@/service/database'
import { convertApiShare, teamApi } from '@/service/team-api'
import type { SharedHost, SharedSnippet, SyncConflict } from './team-types'
import type { TeamStoreGet } from './team-store-context'

const SYNC_CURSOR_KEY_PREFIX = 'terminal.team.syncCursor'
/** Cursor generation of this client; another generation never collides. */
const SYNC_CURSOR_PROTOCOL_VERSION = '2'
/** The single global key of the previous release; adopted once, then removed. */
const LEGACY_SYNC_CURSOR_KEY = SYNC_CURSOR_KEY_PREFIX
/**
 * The cursor is opaque and server issued: stored verbatim, replayed verbatim,
 * never parsed into numbers (docs/phase8/sync-protocol.md §5).
 */
export const CURSOR_PATTERN = /^\d{1,20}(?:\.\d{1,20})*$/
/** Bound on pages per round so a broken `hasMore` cannot loop forever. */
const MAX_SYNC_PAGES = 25

/** Process-local fallback for hosts without localStorage (node, memory only). */
const memoryCursors = new Map<string, string>()

export interface SyncCursorScope {
  endpoint: string
  userId: string
  teamId: string
}

/**
 * One cursor per server, user, team and protocol generation: a single global key
 * let one namespace resume with another's position after switching server, user
 * or team, which silently skips changes or rescans everything.
 */
export function syncCursorStorageKey(scope: SyncCursorScope): string {
  const endpoint = scope.endpoint.trim().replace(/\/+$/, '')
  return [
    SYNC_CURSOR_KEY_PREFIX,
    `v${SYNC_CURSOR_PROTOCOL_VERSION}`,
    encodeURIComponent(endpoint),
    encodeURIComponent(scope.userId),
    encodeURIComponent(scope.teamId),
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
 * A global cursor cannot be attributed to a namespace, so it is handed to the one
 * being synced now - the only one it can belong to - and deleted in the same step
 * so it is never adopted twice. A wrong adoption is harmless: the server validates
 * the cursor against its own watermark and answers with a full resnapshot.
 */
function adoptLegacyCursor(store: Storage, key: string): void {
  const legacy = store.getItem(LEGACY_SYNC_CURSOR_KEY)
  if (legacy === null) return
  store.removeItem(LEGACY_SYNC_CURSOR_KEY)
  if (store.getItem(key) !== null) return
  if (CURSOR_PATTERN.test(legacy)) store.setItem(key, legacy)
}

export function readStoredCursor(scope: SyncCursorScope): string | null {
  const key = syncCursorStorageKey(scope)
  const store = storage()
  if (!store) return memoryCursors.get(key) ?? null
  adoptLegacyCursor(store, key)
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

export type LocalShare =
  | (SharedHost & { _type: 'HOST' })
  | (SharedSnippet & { _type: 'SNIPPET_PACKAGE' })

export function shareData(share: SharedHost | SharedSnippet): unknown {
  return 'hostData' in share ? share.hostData : share.snippetData
}

export function hasData(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && Object.keys(value).length > 0
}

/** The richer of two reports of one conflict wins: only a pull knows the remote side. */
export function mergeConflicts(
  existing: SyncConflict[],
  incoming: SyncConflict[],
): SyncConflict[] {
  if (incoming.length === 0) return existing
  const byId = new Map(existing.map(item => [item.shareId, item]))
  for (const conflict of incoming) {
    const previous = byId.get(conflict.shareId)
    const keepRemote = previous !== undefined
      && hasData(previous.remoteVersion.data)
      && !hasData(conflict.remoteVersion.data)
    byId.set(
      conflict.shareId,
      keepRemote
        ? { ...conflict, remoteVersion: previous.remoteVersion }
        : conflict,
    )
  }
  return [...byId.values()]
}

export function localConflict(
  share: SharedHost | SharedSnippet | undefined,
): SyncConflict {
  return {
    shareId: share?.id ?? '',
    localVersion: {
      updatedAt: share?.updatedAt ?? share?.createdAt ?? 0,
      data: share === undefined ? {} : shareData(share),
    },
    remoteVersion: { updatedAt: 0, data: {}, updatedBy: '' },
  }
}

type SharePayload = Parameters<typeof convertApiShare>[0]

export interface ChangeWindowPayload {
  shares?: SharePayload[]
  deletedShareIds?: string[]
  cursor?: string
  hasMore?: boolean
}

/**
 * Applies one page: deletes first and in the order the server sent them, then
 * every snapshot, so an id deleted and recreated inside one page ends up
 * present. A snapshot that loses against a newer or a locally edited row is
 * reported so the push turns it into a visible conflict instead of dropping the
 * local edit silently.
 */
export async function applyWindow(
  get: TeamStoreGet,
  window: ChangeWindowPayload,
  currentTeamId: string,
): Promise<SyncConflict[]> {
  for (const shareId of window.deletedShareIds ?? []) {
    await removeSharedHost(shareId)
    await removeSharedSnippet(shareId)
  }
  const conflicts: SyncConflict[] = []
  for (const apiShare of window.shares ?? []) {
    // The team comes from the record itself: one window may span teams.
    const converted = convertApiShare({
      ...apiShare,
      teamId: apiShare.teamId || currentTeamId,
    })
    const isHost = 'hostData' in converted
    const data = shareData(converted)
    const record = {
      id: converted.id,
      team_id: converted.teamId || currentTeamId,
      shared_by: converted.sharedBy,
      permission: converted.permission,
      created_at: converted.createdAt,
      version: converted.version ?? null,
      updated_at: converted.updatedAt ?? converted.createdAt,
    }
    const applied = isHost
      ? await addSharedHost({ ...record, host_data: JSON.stringify(data) })
      : await addSharedSnippet({ ...record, snippet_data: JSON.stringify(data) })
    if (applied) continue
    const local = isHost
      ? get().sharedHosts.find(item => item.id === converted.id)
      : get().sharedSnippets.find(item => item.id === converted.id)
    conflicts.push({
      ...localConflict(local),
      shareId: converted.id,
      remoteVersion: {
        updatedAt: record.updated_at,
        data,
        updatedBy: converted.sharedBy,
        version: record.version,
      },
    })
  }
  return conflicts
}

/**
 * Pulls pages until the window is exhausted. A page's cursor is committed only
 * after every change of that page landed, so an interruption re-delivers a page
 * instead of skipping one, and the idempotent upsert makes that replay converge.
 */
export async function pullChanges(
  get: TeamStoreGet,
  scope: SyncCursorScope | null,
  currentTeamId: string,
): Promise<SyncConflict[]> {
  const conflicts: SyncConflict[] = []
  let cursor = scope === null ? null : readStoredCursor(scope)
  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const response = await teamApi.getChanges(cursor ?? undefined)
    if (response.error) throw new Error(response.error)
    const window = response.data
    if (!window) return conflicts
    conflicts.push(...(await applyWindow(get, window, currentTeamId)))
    const next = typeof window.cursor === 'string'
      && CURSOR_PATTERN.test(window.cursor)
      ? window.cursor
      : null
    if (next !== null && scope !== null) storeCursor(scope, next)
    if (!window.hasMore || next === null || next === cursor) return conflicts
    cursor = next
  }
  return conflicts
}

/**
 * Submits the shares this device holds. No server version means the server has
 * never seen the id: CREATE, which a replay answers with an idempotent ack. A
 * version means UPDATE, and it is sent as the proof, so a concurrent write is
 * reported as a conflict instead of being overwritten.
 */
export async function pushLocalShares(
  get: TeamStoreGet,
  currentTeamId: string,
): Promise<SyncConflict[]> {
  const local: LocalShare[] = [
    ...get().sharedHosts.map(item => ({ ...item, _type: 'HOST' as const })),
    ...get().sharedSnippets.map(item => ({
      ...item,
      _type: 'SNIPPET_PACKAGE' as const,
    })),
  ]
  if (local.length === 0) return []
  const pushed = local.map(item => {
    const baseVersion = typeof item.version === 'number' ? item.version : null
    return {
      id: item.id,
      teamId: item.teamId || currentTeamId,
      type: item._type,
      data: shareData(item),
      permission: item.permission.toUpperCase() as 'READONLY' | 'READWRITE',
      operation: baseVersion === null ? ('CREATE' as const) : ('UPDATE' as const),
      ...(baseVersion === null ? {} : { baseVersion }),
    }
  })
  const response = await teamApi.pushChanges(pushed)
  if (response.error) throw new Error(response.error)
  const accepted = new Set([
    ...(response.data?.created ?? []),
    ...(response.data?.updated ?? []),
  ])
  // The server holds this content now, so the row stops being a local edit. The
  // version stays as it was: the next pull is what advances it, and until then a
  // newer remote write still wins over this copy.
  for (const item of local) {
    if (!accepted.has(item.id)) continue
    const record = {
      id: item.id,
      team_id: item.teamId || currentTeamId,
      shared_by: item.sharedBy,
      permission: item.permission,
      created_at: item.createdAt,
      version: typeof item.version === 'number' ? item.version : null,
      updated_at: item.updatedAt ?? item.createdAt,
    }
    if (item._type === 'HOST') {
      await addSharedHost(
        { ...record, host_data: JSON.stringify(item.hostData) },
        'override',
      )
    } else {
      await addSharedSnippet(
        { ...record, snippet_data: JSON.stringify(item.snippetData) },
        'override',
      )
    }
  }
  return (response.data?.conflicts ?? []).map(shareId =>
    localConflict(local.find(item => item.id === shareId)),
  )
}
