import type { PrismaService } from '../prisma.service'
import type { ConflictInfo } from './sync-results'
import { BadRequestException } from '@nestjs/common'
import { buildShareUpdateData } from './share-write-data'
import { classifyBaseVersion, parseVersion } from './sync-protocol'

/**
 * Conflict detection and resolution, split out of `SyncService` when P9.2 took
 * that file past its line limit. Both entry points live here because they share
 * one contract: the version a client proves is the only thing that decides
 * whether a write may proceed, and the security state of the row is never
 * inferred from the payload alone.
 */

/** One item a client asks about: which share, and what it believes it holds. */
export interface ConflictCheckItem {
  id: string
  /** Display only; a millisecond clock never decides (P9.2-5). */
  updatedAt: number
  /** Server version the client's copy is based on, when it can prove one. */
  version?: number
  type: 'HOST' | 'SNIPPET_PACKAGE'
}

/** The LOCAL payload a client submits to keep its own copy of a conflict. */
export interface ConflictLocalData {
  data: unknown
  encryptedData?: string
  isSensitive?: boolean
  permission?: string
  baseVersion?: number
}

export type ConflictResolution = 'LOCAL' | 'REMOTE'

export interface ConflictResolutionResult {
  success: boolean
  error?: string
}

/**
 * Reports the shares whose server copy has moved past what the client holds.
 *
 * A client that sends the version it holds is judged by `classifyBaseVersion`,
 * the same rule `pushChanges` and `resolveConflict` apply, so "is this a
 * conflict?" can never differ between the three endpoints (P9.2-5). `updatedAt`
 * millis remain the fallback only for a client that cannot prove a version — and
 * there two writes inside one millisecond compare equal, which is exactly why it
 * is not the contract.
 */
export async function checkConflicts(
  prisma: PrismaService,
  userId: string,
  items: ConflictCheckItem[],
): Promise<ConflictInfo[]> {
  const conflicts: ConflictInfo[] = []
  for (const item of items) {
    const share = await prisma.share.findUnique({ where: { id: item.id } })
    if (!share) continue
    const membership = await prisma.teamMember.findUnique(
      { where: { teamId_userId: { teamId: share.teamId, userId } } },
    )
    if (!membership) continue
    const currentVersion = parseVersion(share.version)
    const agreed = item.version === undefined
      ? null
      : classifyBaseVersion(share.version, item.version)
    // A version that cannot be classified falls back to the wall clock; every
    // classifiable verdict other than "match" fails closed.
    const isConflict = agreed === null || agreed === 'legacy-timestamp'
      ? share.updatedAt.getTime() > item.updatedAt
      : agreed !== 'match'
    if (!isConflict) continue
    conflicts.push({
      shareId: item.id,
      version: currentVersion,
      isSensitive: share.isSensitive,
      localVersion: { updatedAt: item.updatedAt, data: item },
      remoteVersion: {
        // A sensitive row's plaintext never leaves the server: the client reads
        // it through the share endpoint with the ciphertext it already holds.
        updatedAt: share.updatedAt.getTime(),
        data: share.isSensitive ? {} : share.data,
        updatedBy: share.sharedBy,
        version: currentVersion,
        isSensitive: share.isSensitive,
      },
    })
  }
  return conflicts
}

/**
 * Applies a user's choice for one conflicting share.
 *
 * REMOTE writes nothing on the server: it adopts a snapshot the member can
 * already read, so it needs no write authority. LOCAL overwrites the server's
 * row, so it stays creator-only, and it is a *conditional* overwrite: the client
 * must name the version the user decided against. Substituting the version read
 * in this request made the condition always true, so any client that omitted
 * `baseVersion` could overwrite a write committed after it read the row (P9.2-1).
 */
export async function resolveConflict(
  prisma: PrismaService,
  shareId: string,
  userId: string,
  resolution: ConflictResolution,
  clientData?: ConflictLocalData,
): Promise<ConflictResolutionResult> {
  const share = await prisma.share.findUnique({ where: { id: shareId } })
  if (!share) return { success: false, error: 'Share not found' }
  const membership = await prisma.teamMember.findUnique(
    { where: { teamId_userId: { teamId: share.teamId, userId } } },
  )
  if (!membership) return { success: false, error: 'Not a team member' }
  if (resolution === 'LOCAL' && share.sharedBy !== userId) {
    return { success: false, error: 'Only creator can resolve share conflicts' }
  }
  if (resolution === 'REMOTE') return { success: true }

  if (clientData?.isSensitive === undefined) {
    return {
      success: false,
      error: 'Local conflict data must include an explicit sensitive state',
    }
  }
  if (clientData.isSensitive === true && !clientData.encryptedData) {
    return { success: false, error: 'SENSITIVE_CIPHERTEXT_REQUIRED' }
  }
  // Resolving a conflict must not change whether a share is sensitive: a local
  // plaintext snapshot applied to a sensitive row would write `{}` over the
  // server bytes, and the reverse silently keeps a stale ciphertext. Both
  // directions are refused instead of guessed.
  if (clientData.isSensitive !== share.isSensitive) {
    return { success: false, error: 'SENSITIVE_STATE_MISMATCH' }
  }
  const verdict = classifyBaseVersion(share.version, clientData.baseVersion)
  if (verdict !== 'match') {
    return {
      success: false,
      error: verdict === 'unproven'
        ? 'BASE_VERSION_REQUIRED'
        : 'CONFLICT_STALE_VERSION',
    }
  }
  // Preserving local edits never means consenting to decrypt a share or to
  // change who may read it: both flags keep their stored values, and a sensitive
  // row may only be written with ciphertext, never plaintext data.
  let written: { count: number }
  try {
    written = await prisma.share.updateMany({
      where: { id: shareId, version: share.version },
      data: buildShareUpdateData(clientData, share, true, true),
    })
  } catch (error) {
    // The payload contradicts itself (plaintext declared alongside ciphertext,
    // ciphertext missing for a sensitive row, ...). That is a refused write, not
    // a resolved conflict, and the row is untouched.
    if (error instanceof BadRequestException) {
      return { success: false, error: 'SENSITIVE_PAYLOAD_INVALID' }
    }
    throw error
  }
  if (written.count !== 1) {
    return { success: false, error: 'CONFLICT_STALE_VERSION' }
  }
  return { success: true }
}
