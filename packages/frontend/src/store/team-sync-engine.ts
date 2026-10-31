import {
  addSharedHost,
  addSharedSnippet,
  removeSharedHost,
  removeSharedSnippet,
} from '@/service/database'
import { convertApiShare, teamApi } from '@/service/team-api'
import type { SharedHost, SharedSnippet, SyncConflict } from './team-types'
import type { TeamStoreGet } from './team-store-context'
import type { SyncCursorScope } from './team-sync-cursor'
import {
  CURSOR_PATTERN,
  dropStoredCursor,
  readStoredCursor,
  storeCursor,
} from './team-sync-cursor'

// Cursor storage lives in its own module; re-exported so callers keep one import.
export type { SyncCursorScope } from './team-sync-cursor'
export {
  CURSOR_PATTERN,
  readStoredCursor,
  storeCursor,
  syncCursorStorageKey,
} from './team-sync-cursor'

/** Bound on pages per round so a broken `hasMore` cannot loop forever. */
const MAX_SYNC_PAGES = 25

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
  /** Identity that answered, as the server sees it; compared with the scope. */
  userId?: string
  /** Teams the caller may read right now - the scope the window actually used. */
  teams?: string[]
}

/** What one pull produced: its conflicts, and the scope the server reported. */
export interface PullOutcome {
  conflicts: SyncConflict[]
  /**
   * Authorized team ids, or null when the response carried no scope (an older
   * server). Only this list may decide which local teams survive.
   */
  authorizedTeams: string[] | null
}

/**
 * The record's own team id is the only attribution a snapshot may use. The
 * current team and any default are guesses, and a guessed team files another
 * team's row under an owner the user never authorized, where it is then read as
 * if it belonged there. A row that names no team, or names a team outside the
 * scope the server reported for this same round, is refused instead
 * (docs/phase8/sync-protocol.md §4).
 */
function attributedTeam(apiShare: SharePayload, authorizedTeams: string[] | null): string {
  const teamId = typeof apiShare.teamId === 'string' ? apiShare.teamId.trim() : ''
  if (teamId === '') {
    throw new Error(`Sync record ${apiShare.id} carries no teamId`)
  }
  if (authorizedTeams !== null && !authorizedTeams.includes(teamId)) {
    throw new Error(
      `Sync record ${apiShare.id} belongs to team ${teamId}, which this identity may not read`,
    )
  }
  return teamId
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
  authorizedTeams: string[] | null,
): Promise<SyncConflict[]> {
  for (const shareId of window.deletedShareIds ?? []) {
    await removeSharedHost(shareId)
    await removeSharedSnippet(shareId)
  }
  const conflicts: SyncConflict[] = []
  for (const apiShare of window.shares ?? []) {
    const teamId = attributedTeam(apiShare, authorizedTeams)
    const converted = convertApiShare({ ...apiShare, teamId })
    const isHost = 'hostData' in converted
    const data = shareData(converted)
    const record = {
      id: converted.id,
      team_id: teamId,
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
 *
 * The window spans every team this identity is a member of, decided by the
 * server on each request (docs/phase8/sync-protocol.md §3.8), so nothing here may
 * assume the current team.
 */
export async function pullChanges(
  get: TeamStoreGet,
  scope: SyncCursorScope | null,
): Promise<PullOutcome> {
  const conflicts: SyncConflict[] = []
  let cursor = scope === null ? null : readStoredCursor(scope)
  let authorizedTeams: string[] | null = null
  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const response = await teamApi.getChanges(cursor ?? undefined)
    if (response.error) throw new Error(response.error)
    // The wire payload is read through the scope fields this module declares: the
    // API type is generated from an older shape and must not be the contract here.
    const window = response.data as ChangeWindowPayload | null | undefined
    if (!window) break
    // A token can name another identity than the profile this cursor was stored
    // under. Its rows and its cursor both belong to that other identity, so the
    // round stops before a single change is written or persisted.
    if (
      scope !== null
      && typeof window.userId === 'string'
      && window.userId !== scope.userId
    ) {
      dropStoredCursor(scope)
      throw new Error(
        `Sync identity mismatch: server answered as ${window.userId}, stored cursor belongs to ${scope.userId}`,
      )
    }
    if (authorizedTeams === null && Array.isArray(window.teams)) {
      authorizedTeams = window.teams
    }
    conflicts.push(...(await applyWindow(get, window, authorizedTeams)))
    const next = typeof window.cursor === 'string'
      && CURSOR_PATTERN.test(window.cursor)
      ? window.cursor
      : null
    if (next !== null && scope !== null) storeCursor(scope, next)
    if (!window.hasMore || next === null || next === cursor) break
    cursor = next
  }
  return { conflicts, authorizedTeams }
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
