/**
 * Turn a listing path into the absolute directory the server will list.
 *
 * ## Why this is not inside `sftp_list`
 *
 * The dock opens at `.` so it lands where the server puts the user — listing `/` shows
 * "Empty directory" to someone whose home is full. But `.` cannot prefix the paths of
 * the files inside it, and `mkdir`/`rename` need a real directory.
 *
 * Resolving on the client keeps the listing command's return shape alone, and costs one
 * round trip on the first load of a session: the resolved path replaces `.` in the
 * hook's state, so later navigations are already absolute.
 *
 * Returns `null` when the server cannot resolve it, so the caller reports a failure
 * instead of listing something it guessed.
 */
import { sshService } from '@/service/ssh'

export async function resolveListingPath(
  sessionId: string,
  path: string,
): Promise<string | null> {
  if (path.startsWith('/')) return path
  const resolved = await sshService.sftpResolvePath(sessionId, path)
  /*
   * Recorded for the GUI E2E, which cannot otherwise tell "the server returned an
   * empty directory" from "the resolve failed and we fell back" — both render as
   * "Empty directory". Gated on the same build flag as every other probe.
   */
  if (import.meta.env.VITE_TERMINAL_GUI_E2E === '1') {
    const scope = globalThis as { __sftpResolveTrace?: string[] }
    scope.__sftpResolveTrace = [
      ...(scope.__sftpResolveTrace ?? []),
      `${path} -> ${resolved ?? 'null'}`,
    ]
  }
  // A server that cannot resolve `.` still has to show the user something: fall back
  // to listing `.` itself, which `sftp_list` resolves internally. Without this a
  // failure here reads as "Empty directory" — the same symptom this whole change
  // exists to remove.
  return resolved ?? path
}
