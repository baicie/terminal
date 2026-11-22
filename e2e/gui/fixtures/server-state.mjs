/**
 * Reading the SFTP fixture's directories from Node.
 *
 * ## Why this module exists
 *
 * `e2e-03`'s write case is titled "… — verified on the server". It was not. Every
 * assertion went through `readRows()`, which is
 * `document.querySelectorAll('[data-testid="file-row"]')` — the product's own rendering
 * of the listing it just fetched. A `sftp_mkdir` that wrote to the wrong directory, a
 * rename the server ignored, or a delete that silently succeeded nowhere would all
 * leave the DOM looking correct once the pane's optimistic refresh ran. The case was
 * checking the product against itself.
 *
 * The fixture's sshd runs on this machine, as this account, and the spec process can
 * read the same directories the server serves. So the server's own view of the
 * filesystem is available without adding an SFTP client to the test harness: `readdir`
 * and `stat` on `GUI_E2E_REMOTE_ROOT` are the server's answer, not the pane's.
 *
 * ## The one thing this cannot tell you
 *
 * "The bytes on this host" is only independent of the product because the path is
 * known to the spec and not read back from the pane. That is why every function here
 * takes the root from the environment rather than from the listing: a wrong path fails
 * loudly instead of quietly succeeding somewhere else.
 *
 * It is **not** a chroot. The fixture sshd runs as an ordinary account and would serve
 * `$HOME` just as happily (see `seed-sftp-host.mjs` §containment). Containment is this
 * convention, which is why the root is validated before any read.
 */
import {
  readdirSync,
  statSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * The directory a spec may act on, or `null` when this run has no fixture.
 *
 * Returning `null` rather than throwing is deliberate: the caller records NOT_RUN with
 * a reason, which is a different verdict from a failed assertion.
 */
export const PRIMARY_ROOT_ENV = 'GUI_E2E_REMOTE_ROOT'
export const SECONDARY_ROOT_ENV = 'GUI_E2E_REMOTE_ROOT_2'

export function remoteRoot(envName = PRIMARY_ROOT_ENV) {
  const root = process.env[envName]
  if (!root) return null
  /*
   * The fixture creates this under its own `mkdtemp` work directory. Checking it is a
   * real directory, and not `/` or a home directory, is the difference between a bug
   * in a spec deleting a fixture file and deleting a user's file.
   */
  if (!path.isAbsolute(root)) return null
  if (!root.includes('terminal-gui-sftp-')) return null
  if (!existsSync(root)) return null
  return root
}

/**
 * Guard every path this module is asked to touch.
 *
 * Two checks, and both are needed:
 *
 * 1. **Lexical.** `path.resolve` collapses `..` and `//`, so a caller cannot escape by
 *    accident, and a sibling whose name shares the root's prefix (`remote` vs
 *    `remote-evil`) is refused by comparing with a trailing separator.
 *
 * 2. **Physical.** `root/link -> /Users/someone` passes check 1 — it is lexically
 *    inside the root — and every `fs` call after it follows the link. A staged
 *    symlink therefore read files outside the fixture and, through `seedFile`, could
 *    *write* into a real directory. The physical check walks the path one component
 *    at a time and refuses any component that is a symbolic link (or, on Windows, a
 *    reparse point) whose target leaves the root.
 *
 * Why walk components instead of `realpathSync` on the leaf: the leaf often does not
 * exist yet (a file about to be created, a directory about to be made), and
 * `realpathSync` throws for a missing path. Its parent must still be checked, and the
 * walk does that without requiring presence. A component that does not exist yet is
 * fine — an attacker cannot stage a link there — so the walk accepts it and stops.
 *
 * A caller that fails either check gets `null` and the case refuses to run, rather than
 * acting on the developer's home directory.
 */
function realRoot(root) {
  try {
    return realpathSync(root)
  } catch {
    return root
  }
}

function underRoot(root, relative) {
  if (typeof relative !== 'string') return null
  const resolved = path.resolve(root, relative)
  const withSeparator = root.endsWith(path.sep) ? root : root + path.sep
  if (resolved !== root && !resolved.startsWith(withSeparator)) return null

  // Physical containment. `realRoot` normalises the root itself (a fixture under
  // `/tmp` is a symlink to `/private/tmp` on macOS); each remaining component is
  // examined in place so a link *anywhere* on the way is caught, not only the last.
  const base = realRoot(root)
  const baseWithSeparator = base.endsWith(path.sep) ? base : base + path.sep
  if (resolved === root) return resolved
  const remainder = resolved.slice(withSeparator.length)
  let cursor = root
  for (const part of remainder.split(path.sep)) {
    if (part === '') continue
    cursor = path.join(cursor, part)
    let stats = null
    try {
      stats = lstatSync(cursor)
    } catch {
      // Does not exist yet: nothing can be staged there, and the caller (a write)
      // will create a real directory or file. Accept and stop walking.
      return resolved
    }
    if (stats.isSymbolicLink()) {
      let target
      try {
        target = realpathSync(cursor)
      } catch {
        // A dangling link resolves nowhere. `existsSync` reports it as absent while
        // `writeFileSync` would follow it and create the target — refuse instead.
        return null
      }
      // A link must land strictly *inside* the fixture. Landing exactly on the root
      // is a loop, not an escape, and it is refused for the same reason a loop is
      // dangerous: a walk that follows it has no fixed point to stop at.
      if (!target.startsWith(baseWithSeparator)) return null
      cursor = target
    }
  }
  return resolved
}

/**
 * The names directly inside `relative`, sorted — the server's listing, not the pane's.
 *
 * Throws when the directory is missing or the path is outside the root. A missing
 * directory is a real answer here: "the rename moved it" and "the listing is stale"
 * look identical in the DOM and different on disk.
 */
export function serverEntries(relative = '.', envName = PRIMARY_ROOT_ENV) {
  const root = remoteRoot(envName)
  if (root === null) throw new Error('no GUI_E2E_REMOTE_ROOT; this run has no SFTP fixture')
  const target = underRoot(root, relative)
  if (target === null) {
    throw new Error(`refusing to read ${JSON.stringify(relative)}: outside ${root}`)
  }
  return readdirSync(target).sort()
}

/** Whether `relative` exists on the server, and what it is. */
export function serverEntry(relative, envName = PRIMARY_ROOT_ENV) {
  const root = remoteRoot(envName)
  if (root === null) return null
  const target = underRoot(root, relative)
  if (target === null) return null
  if (!existsSync(target)) return null
  const stats = statSync(target)
  return {
    isDirectory: stats.isDirectory(),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    /// A directory's own size is a block count, so only files carry anything meaningful.
    realSize: stats.isDirectory() ? null : stats.size,
  }
}

/**
 * Check the guard itself, once, so the rest of this module can be trusted.
 *
 * Called by the spec before the first server assertion. Without it a broken `underRoot`
 * would make every case read "the entry is not there", which is indistinguishable from
 * "the product did not create it" — the exact confusion this file exists to end.
 */
export function selfCheck(envName = PRIMARY_ROOT_ENV) {
  const root = remoteRoot(envName)
  if (root === null) return { ok: false, reason: 'no fixture' }
  const escaped = underRoot(root, '../')
  const absoluteEscape = underRoot(root, '/etc')
  return {
    ok: escaped === null && absoluteEscape === null,
    reason:
      escaped === null && absoluteEscape === null
        ? 'the guard rejects both a relative and an absolute escape'
        : `the guard let through ${JSON.stringify({ escaped, absoluteEscape })}`,
  }
}

/**
 * Seed a file the product will upload or download.
 *
 * Written by the spec, read back by `readFileSync` afterwards, so "the same bytes" is
 * a comparison of two files this module owns rather than of a file and a hash the
 * product computed.
 */
export function seedFile(relative, contents, envName = PRIMARY_ROOT_ENV) {
  const root = remoteRoot(envName)
  if (root === null) throw new Error('no GUI_E2E_REMOTE_ROOT; this run has no SFTP fixture')
  const target = underRoot(root, relative)
  if (target === null) {
    throw new Error(`refusing to write ${JSON.stringify(relative)}: outside ${root}`)
  }
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
  return target
}

/** Read a file from the server's own filesystem. */
export function readServerFile(relative, envName = PRIMARY_ROOT_ENV) {
  const root = remoteRoot(envName)
  if (root === null) return null
  const target = underRoot(root, relative)
  if (target === null || !existsSync(target)) return null
  return readFileSync(target)
}
