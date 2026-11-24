/**
 * RC12 — who is writing which target, from the first byte until the check ends.
 *
 * Split out of `sftp-transfer-target.ts` when the local-destination key pushed that file
 * past its line limit. Nothing here changed in the move.
 */
import type { TransferTarget } from './sftp-transfer-target'
import { targetKeyOf } from './sftp-transfer-target'
import { localKeyOf } from './sftp-transfer-local-key'

interface Occupancy {
  /** How many writers hold this target right now. */
  writers: number
  /** How many integrity checks are reading it right now. */
  readers: number
  /**
   * How many writes have **completed** against this target since it was first tracked.
   *
   * Kept alongside the live writer count because the two catch different races:
   *
   *   - a writer that is still running is caught by `writers > 0` (it overlaps the check);
   *   - a writer that finished inside the check's window is caught by this counter moving
   *     (its occupancy was released before the check looked).
   *
   * Neither alone is enough. A counter bumped only at `done` misses a write that started
   * after the snapshot; a live count alone misses one that completed before the check
   * finished but after it began.
   */
  completions: number
}

const occupancy = new Map<string, Occupancy>()

/** A held claim on a target. `release` is idempotent. */
export interface TargetHold {
  key: string
  release: () => void
}

function acquire(key: string, role: 'writers' | 'readers'): TargetHold {
  const current = occupancy.get(key) ?? { writers: 0, readers: 0, completions: 0 }
  current[role] += 1
  occupancy.set(key, current)
  let released = false
  return {
    key,
    release: () => {
      if (released) return
      released = true
      const entry = occupancy.get(key)
      if (!entry) return
      entry[role] -= 1
      // Reclaim the entry as soon as nobody holds it: this map must not grow with the
      // number of paths the app has ever written.
      if (entry[role] < 0) entry[role] = 0
      if (entry.writers <= 0 && entry.readers <= 0) occupancy.delete(key)
    },
  }
}

/**
 * A write to this target has begun — call it when the transfer starts, not when it ends.
 *
 * Taking the claim at the start is what closes the "B began after A's snapshot" hole: a
 * writer that is still running is visible to every check that overlaps it, whether or not
 * its `done` has arrived.
 */
export function beginWrite(target: TransferTarget): TargetHold {
  return acquireBoth(target, 'writers')
}

// RC12: a download writes two places, so it holds both keys and frees both.
function acquireBoth(target: TransferTarget, role: 'writers' | 'readers'): TargetHold {
  const remote = acquire(targetKeyOf(target), role)
  const localKey = localKeyOf(target)
  const local = localKey === null ? null : acquire(localKey, role)
  return {
    key: remote.key,
    release: () => {
      remote.release()
      local?.release()
    },
  }
}

/** A check is reading this target. Held until the hash comparison has been recorded. */
export function beginRead(target: TransferTarget): TargetHold {
  return acquireBoth(target, 'readers')
}

/**
 * Is anything else using this target right now?
 *
 * `excludeWriters` is the caller's own write claim count — a writer that is finishing
 * must not count itself as a competitor.
 */
export function isContended(key: string, role: 'writers' | 'readers'): boolean {
  const entry = occupancy.get(key)
  if (!entry) return false
  return role === 'writers' ? entry.writers > 0 : entry.readers > 0
}

/**
 * Record that a write to this target finished.
 *
 * Called from the same place the writer releases its hold. A check that began before this
 * and is still reading must see the count move — that is the "B completed while A was
 * hashing" race.
 */
export function noteCompletion(target: TransferTarget): number {
  // A finished download completed a write to its local destination too (RC12).
  const localKey = localKeyOf(target)
  if (localKey !== null) {
    const local = occupancy.get(localKey) ?? { writers: 0, readers: 0, completions: 0 }
    local.completions += 1
    occupancy.set(localKey, local)
  }
  const key = targetKeyOf(target)
  const entry = occupancy.get(key) ?? { writers: 0, readers: 0, completions: 0 }
  entry.completions += 1
  occupancy.set(key, entry)
  return entry.completions
}

/** Completed writes recorded for this target; `0` when it is untracked. */
export function completionsOf(key: string): number {
  return occupancy.get(key)?.completions ?? 0
}

/**
 * Drop a target's entry if nobody holds it.
 *
 * `completions` is meaningful only for the window a check cares about, so the entry cannot
 * live forever. The reader releases last, which is the natural point to reclaim: a check
 * that has finished comparing has no further use for the history.
 */
export function releaseIfIdle(key: string): void {
  const entry = occupancy.get(key)
  if (!entry) return
  if (entry.writers <= 0 && entry.readers <= 0) occupancy.delete(key)
}

/** Live target entries. Zero means the registry holds nothing. */
export function activeTargetCount(): number {
  return occupancy.size
}

/**
 * Test-only reset.
 *
 * Deliberately not exported from the product path: clearing the registry in production
 * would let one transfer certify itself against another's overwrite.
 */
export function __resetTargetsForTests(): void {
  occupancy.clear()
}
