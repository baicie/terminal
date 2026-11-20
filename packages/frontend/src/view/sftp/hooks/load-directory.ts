/**
 * Listing one directory, with the guards that make a late answer harmless.
 *
 * ## What it has to get right
 *
 * Three things can make a listing's answer describe somewhere the user is not:
 * the host changed, a newer navigation started, or the component unmounted. The first
 * two are checked at every resume point (the token carries both), and the caller
 * supplies the "still mounted" half through `isCancelled`.
 *
 * ## Why it returns instead of writing
 *
 * Keeping the state writes in the hook means this function is testable without React,
 * and it makes the "nobody is looking at this answer" early returns visible in one
 * place rather than scattered through a `try`.
 */
import { sshService } from '@/service/ssh'
import { resolveListingPath } from './resolve-listing-path'
import { traceSftp } from './sftp-trace'

export type LoadOutcome =
  /** The listing landed and describes the current directory. */
  | { kind: 'listed', path: string, files: unknown[] }
  /** Superseded by a host change or a newer navigation; write nothing. */
  | { kind: 'stale' }
  /** The session could not be opened; the caller stays as it was. */
  | { kind: 'no-session' }
  /** The server refused or the path could not be resolved. */
  | { kind: 'failed', message: string }

export interface LoadDirectoryInput {
  sessionId: string
  requestedPath: string
  /** True once something newer owns the UI. Checked after every await. */
  isStale: () => boolean
}

export async function loadDirectory(input: LoadDirectoryInput): Promise<LoadOutcome> {
  const { sessionId, requestedPath, isStale } = input

  // `.` on the first load; absolute after. See `resolve-listing-path.ts`.
  const effectivePath = await resolveListingPath(sessionId, requestedPath)
  if (isStale()) return { kind: 'stale' }
  if (effectivePath === null) {
    return { kind: 'failed', message: 'the server could not resolve that directory' }
  }

  const result = await sshService.sftpList(sessionId, effectivePath)
  if (isStale()) return { kind: 'stale' }
  if (result.success && result.files) {
    traceSftp(`listed ${effectivePath} -> ${result.files.length} entries`)
    return { kind: 'listed', path: effectivePath, files: result.files }
  }
  return { kind: 'failed', message: result.message ?? 'the listing failed' }
}
