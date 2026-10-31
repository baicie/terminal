import type { PrismaService } from '../prisma.service'
import type { ShareSnapshot } from './sync-results'
import { createHash } from 'node:crypto'

/**
 * Server-issued versions start at 1 and are handed out by "ShareVersion_seq".
 * Any baseVersion at or above this bound cannot be a server version: real
 * millisecond epoch timestamps since 2001-09-09 are >= 1e12. Values in that
 * domain come from legacy clients that sent createdAt/updatedAt instead of a
 * version and are rejected rather than compared (see docs/phase8/sync-protocol.md).
 */
export const LEGACY_TIMESTAMP_VERSION = 1_000_000_000_000

/** Maximum number of change rows returned by one incremental pull. */
export const CHANGES_PAGE_SIZE = 200

export interface PushedShare {
  id: string
  teamId: string
  type: string
  data: unknown
  encryptedData?: string
  isSensitive?: boolean
  permission: string
  baseVersion?: number
  operation?: 'CREATE' | 'UPDATE' | 'DELETE'
}

export interface ChangeWindow {
  cursor: number
  resync: boolean
  shares: ShareSnapshot[]
  deletedShareIds: string[]
}

/**
 * Safe watermark: pg_snapshot_xmin(pg_current_snapshot()) is the lowest
 * transaction id still running, so every change row with a smaller txid is
 * settled (committed or rolled back) and therefore visible. This is the only
 * authority used to advance a cursor - never a clock, and never sequence
 * allocation order.
 */
export async function readSafeWatermark(
  prisma: PrismaService,
): Promise<bigint> {
  const rows = await prisma.$queryRaw<Array<{ safe: string }>>`
    SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS safe`
  const raw = rows[0]?.safe
  return raw === undefined ? 0n : BigInt(raw)
}

/**
 * Decodes a client cursor into a delivery window.
 * A cursor larger than the current watermark cannot come from this database
 * (xmin never decreases) and means a legacy epoch timestamp, a reset cluster or
 * a restore from backup: the only safe answer is a full resnapshot.
 */
export function resolveSinceCursor(
  since: number | undefined,
  safe: bigint,
): { safe: bigint, since: bigint, resync: boolean } {
  if (since === undefined || !Number.isSafeInteger(since) || since < 0) {
    return { safe, since: 0n, resync: true }
  }
  const cursor = BigInt(since)
  if (cursor > safe) return { safe, since: 0n, resync: true }
  return { safe, since: cursor, resync: false }
}

/** Cursors cross the wire as numbers; 2^53 transactions keep them exact. */
export function toCursorNumber(cursor: bigint): number {
  return Number(cursor)
}

export function parseVersion(value: bigint | number | string): number {
  return typeof value === 'number' ? value : Number(value)
}

interface VersionedRow {
  version?: bigint | number | string | null
  updatedAt: Date
}

/**
 * True when the pushed payload is older than the stored row.
 * Server versions are the authority; only a read path that carries no version
 * column at all falls back to comparing updatedAt.
 */
export function isStaleWrite(
  existing: VersionedRow,
  baseVersion: number | undefined,
): boolean {
  if (baseVersion === undefined) return false
  if (!Number.isSafeInteger(baseVersion)) return true
  if (baseVersion >= LEGACY_TIMESTAMP_VERSION) return true
  if (existing.version === undefined || existing.version === null) {
    return existing.updatedAt.getTime() > baseVersion
  }
  return parseVersion(existing.version) > baseVersion
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => canonicalize(entry)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const entries = Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalize(record[key])}`,
  )
  return `{${entries.join(',')}}`
}

/**
 * Idempotency key of a write: the share id plus a canonical digest of the
 * content the client wants to store. Two replays of the same request produce the
 * same digest, which is how a CREATE replay is recognised and answered without
 * writing (see docs/phase8/sync-protocol.md §1.1).
 */
export function shareContentDigest(content: {
  type?: string | null
  data?: unknown
  encryptedData?: string | null
  isSensitive?: boolean | null
  permission?: string | null
}): string {
  const isSensitive = content.isSensitive === true
    || (content.isSensitive !== false && content.encryptedData !== undefined
      && content.encryptedData !== null)
  const normalized = isSensitive
    ? {
        type: content.type ?? null,
        encryptedData: content.encryptedData ?? null,
        isSensitive: true,
        permission: content.permission ?? null,
      }
    : {
        data: content.data ?? null,
        encryptedData: null,
        isSensitive: false,
        permission: content.permission ?? null,
        type: content.type ?? null,
      }
  return createHash('sha256').update(canonicalize(normalized)).digest('hex')
}

function toShareSnapshot(row: {
  shareId: string
  teamId: string
  type: string | null
  data: unknown
  encryptedData: string | null
  isSensitive: boolean | null
  sharedBy: string | null
  permission: string | null
  shareCreatedAt: Date | null
  changedAt: Date
  version: bigint
}): ShareSnapshot {
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
 * Reads [since, safe) over transaction ids and collapses it to the last change
 * per share, so a create-then-delete pair can never be applied out of order by
 * the client. A truncated page advances the cursor only to the last delivered
 * txid: redelivery is absorbed by the client's idempotent upsert instead of
 * silently skipping rows.
 */
export async function readChangeWindow(
  prisma: PrismaService,
  teamIds: string[],
  since: number | undefined,
): Promise<ChangeWindow> {
  const safe = await readSafeWatermark(prisma)
  const window = resolveSinceCursor(since, safe)
  if (teamIds.length === 0) {
    return { cursor: toCursorNumber(safe), resync: window.resync, shares: [], deletedShareIds: [] }
  }
  const rows = await prisma.syncChange.findMany({
    where: { teamId: { in: teamIds }, txid: { gte: window.since, lt: safe } },
    orderBy: { seq: 'asc' },
    take: CHANGES_PAGE_SIZE,
  })
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) latest.set(row.shareId, row)
  const shares: ShareSnapshot[] = []
  const deletedShareIds: string[] = []
  for (const row of latest.values()) {
    if (row.op === 'DELETE') deletedShareIds.push(row.shareId)
    else shares.push(toShareSnapshot(row))
  }
  const truncated = rows.length === CHANGES_PAGE_SIZE
  const cursor = truncated ? rows[rows.length - 1].txid : safe
  return {
    cursor: toCursorNumber(cursor),
    resync: window.resync,
    shares,
    deletedShareIds,
  }
}
