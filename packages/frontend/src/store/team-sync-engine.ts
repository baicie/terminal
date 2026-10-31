import {
  addSharedHost,
  addSharedSnippet,
  removeSharedHost,
  removeSharesAbsentFromSnapshot,
  removeSharedSnippet,
} from '@/service/database'
import { convertApiShare, teamApi } from '@/service/team-api'
import type { SyncConflict } from './team-types'
import type { TeamStoreGet } from './team-store-context'
import { localConflict, shareData } from './team-sync-shares'
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

/**
 * Bound on pages per round so a broken `hasMore` cannot loop forever.
 *
 * Exported because a caller has to be able to tell "the window ended" from "this
 * round ran out of pages" — the two look identical from the return value otherwise,
 * and a truncated round used to report itself as a finished sync (#P9.0-7.3).
 */
export const MAX_SYNC_PAGES = 25

// The share shape, its conflict record and the push live in team-sync-shares.ts;
// re-exported here so callers keep one import.
export {
  hasData,
  localConflict,
  mergeConflicts,
  pushLocalShares,
  shareData,
} from './team-sync-shares'
export type { LocalShare } from './team-sync-shares'

type SharePayload = Parameters<typeof convertApiShare>[0]

export interface ChangeWindowPayload {
  shares?: SharePayload[]
  deletedShareIds?: string[]
  cursor?: string
  hasMore?: boolean
  /**
   * The server could not prove it issued this client's cursor and answered with the
   * whole window instead. Only such a window can prove a row is absent, so only a
   * round carrying this flag may delete local rows (§5).
   */
  resync?: boolean
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
  /**
   * True when the round stopped at `MAX_SYNC_PAGES` while the server still reported
   * `hasMore`. The window is genuinely larger than one round, so the round is
   * incomplete — not failed, and not finished. The cursor is persisted page by page,
   * so the next round resumes where this one stopped.
   */
  hasMore: boolean
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
  // A resnapshot is the only answer that can prove a row is gone: it is the whole
  // window cut at one position, so "not delivered" means "not on the server". An
  // incremental window proves nothing, because the deletions it does not name belong
  // to positions this client already passed.
  let resnapshot = false
  const delivered: string[] = []
  // The loop is assumed to run out of pages; every real end of the window clears it.
  let truncated = true
  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const response = await teamApi.getChanges(cursor ?? undefined)
    if (response.error) throw new Error(response.error)
    // The wire payload is read through the scope fields this module declares: the
    // API type is generated from an older shape and must not be the contract here.
    const window = response.data as ChangeWindowPayload | null | undefined
    if (!window) {
      truncated = false
      break
    }
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
    if (window.resync === true) resnapshot = true
    for (const apiShare of window.shares ?? []) delivered.push(apiShare.id)
    conflicts.push(...(await applyWindow(get, window, authorizedTeams)))
    const next = typeof window.cursor === 'string'
      && CURSOR_PATTERN.test(window.cursor)
      ? window.cursor
      : null
    if (next !== null && scope !== null) storeCursor(scope, next)
    if (!window.hasMore || next === null || next === cursor) {
      truncated = false
      break
    }
    cursor = next
  }
  // Only a complete resnapshot may delete anything: a truncated one has not seen the
  // whole window, and an incremental one never could. `authorizedTeams === null` means
  // the server named no scope, so no absence was proven either.
  if (resnapshot && !truncated && authorizedTeams !== null) {
    const removed = await removeSharesAbsentFromSnapshot(
      authorizedTeams,
      delivered,
    )
    if (removed > 0) {
      console.info(
        `[Sync] removed ${removed} local share(s) a complete resnapshot proved the server no longer has`,
      )
    }
  }
  return { conflicts, authorizedTeams, hasMore: truncated }
}


