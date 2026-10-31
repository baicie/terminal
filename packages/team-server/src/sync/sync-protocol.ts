import type { Prisma } from '@prisma/client'
import type { PrismaService } from '../prisma.service'
import { createHash } from 'node:crypto'

/**
 * Server-issued versions start at 1 ("ShareVersion_seq"). A baseVersion at or
 * above this bound cannot be one - millisecond timestamps since 2001-09-09 are
 * >= 1e12 - so it comes from a legacy client and is rejected, not compared.
 */
export const LEGACY_TIMESTAMP_VERSION = 1_000_000_000_000

/** Maximum number of change rows returned by one incremental pull. */
export const CHANGES_PAGE_SIZE = 200

/** Cursor protocol version; a cursor of another version resyncs, never guessed at. */
export const SYNC_CURSOR_VERSION = 2

/** Fixed width of each cursor field so string order equals numeric order. */
const CURSOR_DIGITS = 20
const CURSOR_FIELD = /^\d{1,20}$/
const LEGACY_CURSOR = /^\d+$/

/** Exclusive lower position in the change log: (txid, seq) lexicographic. */
export interface SyncCursorPosition {
  txid: bigint
  seq: bigint
}

export interface ChangeWindowAnchor {
  /** Exclusive upper bound over transaction ids, frozen for the whole run. */
  bound: bigint
  after: SyncCursorPosition | null
  resync: boolean
  /**
   * True when the cursor came from protocol 1 (a bare decimal watermark). Such a
   * client loops on the numeric timestamp it was given, so it cannot page: it is
   * answered with the whole window or with an explicit upgrade demand.
   */
  legacy?: boolean
}

/**
 * pg_snapshot_xmin(pg_current_snapshot()) is the lowest transaction id still
 * running, so every change row with a smaller txid is settled and visible. The
 * only cursor authority - never a clock, never sequence allocation order.
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
 * Wire format `2.<bound>.<txid>.<seq>`, every field zero padded to 20 digits so
 * cursor order equals numeric order. `bound = 0` marks a finished run.
 */
export function formatSyncCursor(
  bound: bigint,
  txid: bigint,
  seq: bigint,
): string {
  const fields = [bound, txid, seq].map((field) => {
    const text = field.toString()
    if (field < 0n || text.length > CURSOR_DIGITS) {
      throw new RangeError('Sync cursor field out of range')
    }
    return text.padStart(CURSOR_DIGITS, '0')
  })
  return [String(SYNC_CURSOR_VERSION), ...fields].join('.')
}

function legacyAnchor(cursor: bigint, safeNow: bigint): ChangeWindowAnchor {
  if (cursor > safeNow) {
    return { bound: safeNow, after: null, resync: true, legacy: true }
  }
  // A single number only names a transaction boundary, so it resumes at "every
  // row of txid >= cursor": the same superset the legacy implementation read.
  // seq = -1 sits just before the first row of that transaction, which is what
  // makes the boundary inclusive of txid = cursor.
  return {
    bound: safeNow,
    after: { txid: cursor, seq: -1n },
    resync: false,
    legacy: true,
  }
}

/**
 * Anything the server cannot prove it issued - malformed, another protocol
 * version, or a watermark above the current one (cluster reset, restore) -
 * degrades to a full resnapshot instead of a guess.
 */
export function resolveChangeWindowAnchor(
  raw: string | number | undefined | null,
  safeNow: bigint,
): ChangeWindowAnchor {
  const full: ChangeWindowAnchor = { bound: safeNow, after: null, resync: true }
  if (raw === undefined || raw === null) return full
  const text = String(raw).trim()
  if (text === '') return full
  if (LEGACY_CURSOR.test(text)) {
    return Number.isSafeInteger(Number(text))
      ? legacyAnchor(BigInt(text), safeNow)
      : full
  }
  const parts = text.split('.')
  if (parts.length !== 4) return full
  if (parts[0] !== String(SYNC_CURSOR_VERSION)) return full
  if (!parts.slice(1).every(part => CURSOR_FIELD.test(part))) return full
  const [bound, txid, seq] = [BigInt(parts[1]), BigInt(parts[2]), BigInt(parts[3])]
  if (bound === 0n) {
    // Finished run: everything below txid is delivered, so resume at txid itself.
    if (seq !== 0n || txid > safeNow) return full
    return { bound: safeNow, after: { txid, seq: -1n }, resync: false }
  }
  if (bound > safeNow || txid > bound) return full
  return { bound, after: { txid, seq }, resync: false }
}

export function parseVersion(value: bigint | number | string): number {
  return typeof value === 'number' ? value : Number(value)
}

/**
 * Strict optimistic-concurrency verdict of a submitted baseVersion. `updatedAt`
 * never takes part: millisecond precision makes two writes in one millisecond
 * compare equal, and a check that cannot fail is not a check.
 */
export type BaseVersionVerdict =
  | 'match'
  | 'stale'
  | 'future'
  | 'unproven'
  | 'legacy-timestamp'
  | 'unverifiable'

export function classifyBaseVersion(
  existingVersion: bigint | number | string | null | undefined,
  baseVersion: number | undefined,
): BaseVersionVerdict {
  const usable = baseVersion !== undefined
    && Number.isSafeInteger(baseVersion)
    && baseVersion >= 0
  if (!usable) return 'unproven'
  if (baseVersion >= LEGACY_TIMESTAMP_VERSION) return 'legacy-timestamp'
  // No version on the row means nothing to compare against: fail closed.
  if (existingVersion === undefined || existingVersion === null) {
    return 'unverifiable'
  }
  const current = typeof existingVersion === 'bigint'
    ? existingVersion
    : BigInt(existingVersion)
  const submitted = BigInt(baseVersion)
  if (submitted > current) return 'future'
  if (submitted < current) return 'stale'
  return 'match'
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
 * Idempotency key of a write: a canonical digest of the content the client wants
 * to store, so a replay of one request is answered without writing (§1.1).
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

/**
 * Ordering and the resume boundary are the same key, (txid, seq), so the rows of
 * one transaction form one contiguous run and a boundary inside a transaction
 * resumes exactly where it stopped.
 */
export function buildChangeWhere(
  teamIds: string[],
  anchor: ChangeWindowAnchor,
): Prisma.SyncChangeWhereInput {
  const where: Prisma.SyncChangeWhereInput = {
    teamId: { in: teamIds },
    txid: { lt: anchor.bound },
  }
  if (anchor.after === null) return where
  const { txid, seq } = anchor.after
  where.OR = [{ txid: { gt: txid } }, { txid, seq: { gt: seq } }]
  return where
}
