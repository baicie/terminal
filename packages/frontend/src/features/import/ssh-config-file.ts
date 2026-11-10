/**
 * The filesystem edge of the OpenSSH import.
 *
 * Kept by itself so the parsing and planning layers never touch the disk, and so
 * the one place that does is small enough to read in full. It reads exactly the
 * path it is given — no `Include` walking, no home-directory expansion beyond the
 * `~` the user typed, no globbing.
 */

import { homeDir } from '@tauri-apps/api/path'
import { readTextFile } from '@tauri-apps/plugin-fs'

export type ReadSshConfigResult =
  | { ok: true; content: string }
  | { ok: false; message: string }

/** `~/.ssh/config`, the file ssh itself reads when the user has no `-F`. */
export function defaultSshConfigPath(): string {
  return '~/.ssh/config'
}

/**
 * Expand a leading `~` so the file API, which has no notion of a shell, gets a
 * real path. Only `~/` and a bare `~` are handled; `~user` forms are returned
 * unchanged, because resolving another user's home is not something an importer
 * should do silently.
 */
export async function expandHome(path: string): Promise<string> {
  if (path !== '~' && !path.startsWith('~/')) return path
  const home = await homeDir()
  const trimmed = home.endsWith('/') || home.endsWith('\\') ? home.slice(0, -1) : home
  return path === '~' ? trimmed : `${trimmed}${path.slice(1)}`
}

/** Read one config file, reporting failure in words a user can act on. */
export async function readSshConfigFile(path: string): Promise<ReadSshConfigResult> {
  let resolved: string
  try {
    resolved = await expandHome(path)
  } catch {
    return {
      ok: false,
      message: `The home directory could not be found, so ${path} cannot be read. Choose the file explicitly instead.`,
    }
  }

  try {
    const content = await readTextFile(resolved)
    return { ok: true, content }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // Two failure modes a user meets constantly and can tell apart:
    // "I never had one" and "it is there but I cannot open it".
    if (/not found|no such file/i.test(detail)) {
      return {
        ok: false,
        message: `There is no ssh config at ${resolved}. In Tabby that file lives in Tabby's own settings; here you can also paste a config or point the picker at another file.`,
      }
    }
    return {
      ok: false,
      message: `${resolved} could not be read (${detail}). Check the file permissions, or choose a different file.`,
    }
  }
}
