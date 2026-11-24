/**
 * RC12 — the local half of a download's identity.
 *
 * ## The gap this closes
 *
 * A transfer's key is built from the **remote** side: connection coordinates plus the
 * remote path. That is the whole story for an upload — the bytes go to one server path
 * and nothing local is touched. A download has a second destination, the local file, and
 * two downloads of *different* remote files onto one local path write the same bytes on
 * this machine.
 *
 * Measured before this module existed: `/srv/a.bin → /tmp/same.bin` and
 * `/srv/b.bin → /tmp/same.bin` produced two different keys, so neither integrity check
 * could see the other's write. Whichever finished last replaced the other's bytes, and
 * both could report `verified`.
 *
 * ## Why it is a separate key rather than a suffix
 *
 * Appending the local path to the remote key would put two different kinds of path into
 * one namespace, where a remote `/tmp/x` and a local `/tmp/x` would collide for no
 * reason. A download holds **both** keys; the remote one keeps its meaning for every
 * existing caller.
 */
import type { TransferTarget } from './sftp-transfer-target'

/**
 * The key for a download's local destination, or `null` when it has none.
 *
 * `null` means "this target has no local side" (an upload), never "unknown" — a missing
 * value must not be read as a clean bill of health.
 *
 * The path is compared **as written**. This process is the only writer, so there is no
 * second spelling to normalise away, and resolving symlinks here would need the
 * filesystem access the key is deliberately free of — the same capability boundary the
 * remote side states.
 */
export function localKeyOf(target: TransferTarget): string | null {
  if (!target.localPath) return null
  return `local\u0000${target.localPath}`
}
