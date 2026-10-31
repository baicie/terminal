import type { SyncChange } from '@prisma/client'
import type { PrismaService } from '../prisma.service'
import type { ChangeWindowAnchor } from './sync-protocol'
import type { ChangeWindow, ShareSnapshot } from './sync-results'
import {
  buildChangeWhere,
  CHANGES_PAGE_SIZE,
  formatSyncCursor,
  parseVersion,
  readSafeWatermark,
  resolveChangeWindowAnchor,
} from './sync-protocol'

/**
 * Cap on a protocol-1 (bare decimal watermark) response. Such a client loops on
 * the numeric timestamp it was handed, so a truncated page would be skipped
 * forever; the server therefore delivers the window whole, or refuses and asks
 * for an upgrade. See docs/phase8/sync-protocol.md §3.7.
 */
export const LEGACY_FULL_DELIVERY_LIMIT = 5000

/** One membership as the scope resolver sees it: which team, and when it joined. */
export interface SyncScopeMember {
  teamId: string
  /**
   * Transaction id of the membership row's creation (TeamMember.joinedTxid).
   * Absent means "no evidence either way" and never invalidates a cursor, which
   * is what a migration backfill or a test double without the column looks like.
   */
  joinedTxid?: bigint | number | string | null
}

function membershipTxid(member: SyncScopeMember): bigint | null {
  const raw = member.joinedTxid
  if (raw === null || raw === undefined) return null
  return typeof raw === 'bigint' ? raw : BigInt(raw)
}

/**
 * The pull scope is the caller's complete membership set, decided by the server
 * on every request. A cursor position is only a position *inside the scope it was
 * cut for*, and that scope is exactly the memberships that already existed when
 * the window was frozen. Reconstructing it from `issuedBound` keeps every page of
 * one run on the same scope (a join that lands mid-run cannot splice half a
 * team's history into the middle of a window), and a team joined at or after that
 * bound never had its history inside the window, so resuming there would start
 * past it and skip it forever - silently. Such a position is discarded and the
 * whole window is delivered instead, never a guess (docs/phase8/sync-protocol.md
 * §3.8). Protocol-1 numeric cursors go through the same rule.
 */
function scopeAnchor(
  anchor: ChangeWindowAnchor,
  members: SyncScopeMember[],
): ChangeWindowAnchor {
  if (anchor.after === null) return anchor
  const joinedLater = members.some((member) => {
    const joined = membershipTxid(member)
    return joined !== null && joined >= anchor.issuedBound
  })
  return joinedLater ? { ...anchor, after: null, resync: true } : anchor
}

/**
 * Teams this window may contain: the memberships that existed at the bound the
 * window was frozen at. A fresh window starts at zero, so its scope is the set as
 * of the current bound; a continued one keeps the scope of the run it belongs to.
 */
function scopeTeamIds(
  anchor: ChangeWindowAnchor,
  members: SyncScopeMember[],
): string[] {
  const asOf = anchor.after === null ? anchor.bound : anchor.issuedBound
  return members
    .filter((member) => {
      const joined = membershipTxid(member)
      return joined === null || joined < asOf
    })
    .map(member => member.teamId)
}

function toShareSnapshot(row: SyncChange): ShareSnapshot {
  return {
    id: row.shareId,
    teamId: row.teamId,
    type: row.type ?? 'HOST',
    data: row.data,
    encryptedData: row.encryptedData,
    isSensitive: row.isSensitive ?? false,
    sharedBy: row.sharedBy ?? '',
    permission: row.permission ?? 'READONLY',
    createdAt: (row.shareCreatedAt ?? row.changedAt).toISOString(),
    updatedAt: row.changedAt.toISOString(),
    version: parseVersion(row.version),
  }
}

/**
 * Collapses one page to the last change per share, so a create-then-delete pair
 * is never applied out of order: (txid, seq) order and write order can disagree,
 * and only the highest seq is the current state.
 */
function collapseChanges(rows: SyncChange[]): {
  shares: ShareSnapshot[]
  deletedShareIds: string[]
} {
  const latest = new Map<string, SyncChange>()
  for (const row of rows) {
    const current = latest.get(row.shareId)
    if (current === undefined || row.seq > current.seq) latest.set(row.shareId, row)
  }
  const ordered = [...latest.values()].sort((left, right) =>
    left.seq < right.seq ? -1 : left.seq > right.seq ? 1 : 0,
  )
  const shares: ShareSnapshot[] = []
  const deletedShareIds: string[] = []
  for (const row of ordered) {
    if (row.op === 'DELETE') deletedShareIds.push(row.shareId)
    else shares.push(toShareSnapshot(row))
  }
  return { shares, deletedShareIds }
}

function emptyWindow(safe: bigint, resync: boolean): ChangeWindow {
  return {
    cursor: formatSyncCursor(0n, safe, 0n),
    watermark: Number(safe),
    hasMore: false,
    resync,
    shares: [],
    deletedShareIds: [],
  }
}

/**
 * Protocol 1 can only carry one number, and the client feeds the `timestamp` it
 * received back as the next `since` - it has no way to page. A truncated page
 * would therefore be skipped forever, so this path delivers the window whole.
 * Above the cap it delivers nothing and leaves the watermark where it was, so a
 * client that ignores the flag stalls on the same request instead of losing
 * rows (docs/phase8/sync-protocol.md §3.7).
 */
async function readLegacyWindow(
  prisma: PrismaService,
  teamIds: string[],
  anchor: ChangeWindowAnchor,
  safe: bigint,
  cursor: string | number,
): Promise<ChangeWindow> {
  const rows = await prisma.syncChange.findMany({
    where: buildChangeWhere(teamIds, anchor),
    orderBy: [{ txid: 'asc' }, { seq: 'asc' }],
    take: LEGACY_FULL_DELIVERY_LIMIT + 1,
  })
  if (rows.length > LEGACY_FULL_DELIVERY_LIMIT) {
    return {
      ...emptyWindow(safe, anchor.resync),
      cursor: String(cursor).trim(),
      watermark: anchor.after === null ? 0 : Number(anchor.after.txid),
      upgradeRequired: true,
    }
  }
  return { ...emptyWindow(safe, anchor.resync), ...collapseChanges(rows) }
}

/**
 * Reads the frozen window and collapses it to the last change per share. For
 * protocol 2 the boundary is the position of the last delivered row, so one
 * transaction larger than a page still progresses and a row with a smaller txid
 * but a larger seq is never left behind a page boundary.
 */
export async function readChangeWindow(
  prisma: PrismaService,
  members: SyncScopeMember[],
  cursor: string | number | undefined,
): Promise<ChangeWindow> {
  const safe = await readSafeWatermark(prisma)
  const anchor = scopeAnchor(resolveChangeWindowAnchor(cursor, safe), members)
  const teamIds = scopeTeamIds(anchor, members)
  if (teamIds.length === 0) return emptyWindow(safe, anchor.resync)
  if (anchor.legacy === true && cursor !== undefined) {
    return readLegacyWindow(prisma, teamIds, anchor, safe, cursor)
  }
  const rows = await prisma.syncChange.findMany({
    where: buildChangeWhere(teamIds, anchor),
    orderBy: [{ txid: 'asc' }, { seq: 'asc' }],
    take: CHANGES_PAGE_SIZE,
  })
  const lastRow = rows.length === 0 ? undefined : rows[rows.length - 1]
  const truncated = rows.length === CHANGES_PAGE_SIZE
  // The last row of a full page always sits strictly past the anchor unless the
  // query is broken. Demanding a strict advance turns a regression into "end of
  // window", never into endless redelivery of the same page.
  const advanced = lastRow !== undefined
    && (anchor.after === null
      || lastRow.txid > anchor.after.txid
      || (lastRow.txid === anchor.after.txid && lastRow.seq > anchor.after.seq))
  const hasMore = truncated && advanced
  return {
    cursor: hasMore && lastRow !== undefined
      ? formatSyncCursor(anchor.bound, lastRow.txid, lastRow.seq)
      : formatSyncCursor(0n, anchor.bound, 0n),
    watermark: Number(safe),
    hasMore,
    resync: anchor.resync,
    ...collapseChanges(rows),
  }
}
