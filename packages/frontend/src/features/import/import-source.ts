/**
 * Reading an OpenSSH config the user picked, and turning it into a plan.
 *
 * The parser and the planner are pure and already tested; this is the thin layer
 * that touches the file system, so that the parts which can go wrong in ways a
 * user must see — no file, unreadable file, not a config at all — have one place
 * to be reported from.
 *
 * What this module deliberately does not do:
 *
 * - follow `Include`. The user picked one file; reading others it mentions would
 *   be reading files they did not choose.
 * - touch the network, resolve DNS, or execute anything the file names.
 * - import without a plan. Every caller gets the candidates and the warnings and
 *   has to decide, which is what makes the preview meaningful rather than
 *   decorative.
 */

import { parseSshConfig } from './ssh-config-parser'
import type { ParsedSshConfig } from './ssh-config-parser'
import { planImport } from './import-plan'
import type { ImportPlan } from './import-plan'
import { defaultSshConfigPath, readSshConfigFile } from './ssh-config-file'

export interface OpenSshImportSource {
  /** The path the user chose, shown in the preview so they can tell two apart. */
  path: string
  plan: ImportPlan
  parsed: ParsedSshConfig
}

export interface OpenSshImportFailure {
  ok: false
  /** Why nothing can be imported. Names a next step; never a stack trace. */
  message: string
}

export type OpenSshImportResult =
  | { ok: true; source: OpenSshImportSource }
  | OpenSshImportFailure

/**
 * Parse `text` as an ssh config and plan the import against the hosts already
 * stored here.
 *
 * Separated from the file read so every branch below is testable without a
 * filesystem, and so the same function serves both "the user picked a file" and
 * "the user pasted text".
 */
export function planOpenSshImport(
  text: string,
  options: { path: string; existingHosts: Parameters<typeof planImport>[1]['existingHosts'] },
): OpenSshImportResult {
  const parsed = parseSshConfig(text)

  if (parsed.hosts.length === 0) {
    // An empty plan is not a successful import. Saying "0 hosts" and closing the
    // dialog leaves the user unsure whether the file was wrong or the app was.
    return {
      ok: false,
      message:
        'No hosts were found in this file. An ssh config needs at least one "Host" block.',
    }
  }

  const plan = planImport(parsed, { existingHosts: options.existingHosts })
  return { ok: true, source: { path: options.path, plan, parsed } }
}

/**
 * Read and plan a config the user selected.
 *
 * A missing or unreadable file is reported as a failure with the path in it: the
 * dialog that opened the picker stays open, so the user can pick a different one
 * without starting over.
 */
export async function loadOpenSshImport(
  existingHosts: Parameters<typeof planImport>[1]['existingHosts'],
  path?: string,
): Promise<OpenSshImportResult> {
  const target = path ?? defaultSshConfigPath()
  const read = await readSshConfigFile(target)
  if (!read.ok) {
    return { ok: false, message: read.message }
  }
  return planOpenSshImport(read.content, { path: target, existingHosts })
}

export { parseSshConfig }
export type { ImportPlan, ParsedSshConfig }
