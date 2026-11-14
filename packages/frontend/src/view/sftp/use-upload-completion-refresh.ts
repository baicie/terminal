/**
 * Refresh a remote listing when an upload has actually landed.
 *
 * `uploadPaths()` resolves when every file has been **scheduled**, not when the
 * bytes are on the server: `uploadFile` returns right after `scheduleTransfer()`,
 * and the queue may still have the job waiting behind three others. Refreshing
 * there lists the directory before the new file exists, so the user is told the
 * upload succeeded and sees no new row.
 *
 * The completion signal is the transfer's own terminal state, so this works for
 * every entry point — the toolbar button, drag-and-drop, and a bare `uploadFile()`
 * call — rather than only the one that happens to await something.
 *
 * Four things it refuses to do, each of which was a real way to get this wrong:
 *
 *   - refresh on `error` / `cancelled`: nothing new to show, and a listing is not
 *     free over a shared SFTP channel;
 *   - refresh a directory the panel is no longer showing: a host switch mid-upload
 *     would load one server's tree into another's listing;
 *   - refresh after disposal: the dock closed and the component is gone;
 *   - refresh once per *file*: a dozen files would mean a dozen directory listings
 *     on the same channel, so a batch is folded into one.
 *
 * How a batch is identified: transfers are grouped by `sessionId` + the directory
 * their `remotePath` lives in. That is derivable from the record itself, so no new
 * store field and no change to `uploadPaths()`'s signature — which matters because
 * its return value is already relied on by every caller.
 */
import { useEffect, useRef } from 'react'
import { useTransferQueue } from '@/store/transfer-queue'
import type { TransferRecord, TransferStatus } from '@/store/transfer-queue'

/** The directory a remote path lives in. `/srv/a/b.bin` → `/srv/a`. */
export function remoteDirOf(remotePath: string): string {
  const trimmed = remotePath.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  if (cut <= 0) return cut === 0 ? '/' : ''
  return trimmed.slice(0, cut)
}

export interface UploadRefreshTarget {
  sessionId: string
  /** Directory currently on screen. */
  remoteDir: string
  loadDir: (path: string) => void
}

/**
 * Watches transfer status changes and decides when the listing is stale.
 *
 * Separated from the hook so the rules are testable without React and so the effect
 * has exactly one job: translating store updates into `observe` calls.
 */
export interface UploadRefreshTracker {
  /** Feed every status change the store reports. */
  observe: (record: Pick<TransferRecord, 'id' | 'kind' | 'sessionId' | 'remotePath' | 'status'>) => void
  /** Tell it what the panel shows now. */
  setTarget: (target: UploadRefreshTarget | null) => void
  dispose: () => void
}

/**
 * How long a landing waits for company before the listing is reloaded.
 *
 * A batch is not one store update: the queue runs three at a time, so a dozen files
 * land in four waves spread over the whole upload. Refreshing per wave would list
 * the directory four times on the same channel. Waiting for a quiet moment costs the
 * user a fraction of a second and produces exactly one listing.
 *
 * Long enough to span the gap between two waves of a small batch, short enough that
 * a user who uploads one file and looks at the list is not left wondering.
 */
const COALESCE_MS = 250

export function createUploadRefreshTracker(
  target: UploadRefreshTarget | null,
  coalesceMs: number = COALESCE_MS,
): UploadRefreshTracker {
  let current = target
  let disposed = false
  /** A refresh is scheduled and will fire unless more files land first. */
  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * Transfers already accounted for. A transfer that reaches `done` and later has
   * an unrelated store update must not be counted twice.
   */
  const settled = new Set<string>()

  const cancel = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  return {
    observe(record) {
      if (disposed || current === null) return
      if (record.kind !== 'upload') return
      // Only a landing puts a new name in the listing.
      if (record.status !== 'done') return
      if (settled.has(record.id)) return
      if (record.sessionId !== current.sessionId) return
      if (remoteDirOf(record.remotePath) !== current.remoteDir) return

      settled.add(record.id)
      // Each landing pushes the refresh out; the batch refreshes once, at the end.
      cancel()
      const shown = current
      timer = setTimeout(() => {
        timer = null
        if (disposed) return
        // The panel may have moved while files were landing.
        if (current?.sessionId !== shown.sessionId) return
        if (current?.remoteDir !== shown.remoteDir) return
        current.loadDir(current.remoteDir)
      }, coalesceMs)
    },
    setTarget(next) {
      // A new target is a different question: the old batch's `done` events say
      // nothing about this directory, and a refresh scheduled for it must not fire
      // against the new one.
      if (
        next?.sessionId !== current?.sessionId ||
        next?.remoteDir !== current?.remoteDir
      ) {
        cancel()
        settled.clear()
      }
      current = next
    },
    dispose() {
      disposed = true
      cancel()
      settled.clear()
    },
  }
}

/**
 * Wire the tracker to the transfer store.
 *
 * `loadDirRef` is a ref because `loadDir` gets a new identity on most renders; an
 * effect depending on it would resubscribe constantly and could miss the very
 * update it is waiting for.
 *
 * The subscription is to the whole store and diffs statuses itself, because the
 * store has no per-transfer event. `seen` is what makes that cheap and correct:
 * an update that does not change a status is not an event.
 */
export function useUploadCompletionRefresh(target: UploadRefreshTarget | null): void {
  const loadDirRef = useRef(target?.loadDir)
  loadDirRef.current = target?.loadDir
  // Destructured so the effect depends on values, not on an object identity the
  // caller rebuilds every render.
  const sessionId = target?.sessionId ?? null
  const remoteDir = target?.remoteDir ?? null

  useEffect(() => {
    if (sessionId === null || remoteDir === null) return
    const tracker = createUploadRefreshTracker({
      sessionId,
      remoteDir,
      loadDir: path => loadDirRef.current?.(path),
    })
    const seen = new Map<string, TransferStatus>()
    const unsubscribe = useTransferQueue.subscribe(state => {
      for (const transfer of state.transfers) {
        if (seen.get(transfer.id) === transfer.status) continue
        seen.set(transfer.id, transfer.status)
        tracker.observe(transfer)
      }
    })
    return () => {
      unsubscribe()
      tracker.dispose()
    }
  }, [sessionId, remoteDir])
}
