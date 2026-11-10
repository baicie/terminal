/**
 * Turns parsed OpenSSH hosts into an import plan the user reviews before any row
 * is written.
 *
 * Rules that the tests hold this to:
 *
 * - an existing host is never overwritten: a duplicate is marked and skipped by
 *   default, and the user has to pick it explicitly;
 * - a selected entry carries a deterministic id derived from host+user+port, so
 *   importing the same file twice creates nothing the second time (idempotence);
 * - a private key is referenced by path, never copied into the row - the path is
 *   stored so the connection can load it, and the key material stays where the
 *   user keeps it;
 * - a hostname this app cannot use is refused with a reason, not silently dropped.
 */

import type { Host } from '@/types'
import type { ParsedSshConfig, ParsedSshHost } from './ssh-config-parser'
import { isUsableHostname } from './ssh-config-parser'
import { resolveProxyJumps } from './import-proxy-jump'

export type ImportDecision = 'create' | 'duplicate' | 'invalid'

export interface ImportCandidate {
  /** Stable id: the same config entry always yields the same id. */
  id: string
  /** Name to show and store (the first alias). */
  name: string
  hostname: string
  port: number
  username: string
  authType: Host['authType']
  identityFile: string | null
  proxyJump: string | null
  /**
   * The candidate id this entry's ProxyJump resolves to, or null when it names
   * nothing importable.
   *
   * `proxyJump` is an ssh-config alias (`bastion`) or a `user@host:port` triple.
   * A jump *id* is this app's internal identifier. Storing the alias in the id
   * column produced a reference to a host that does not exist and silently
   * dropped the jump requirement.
   */
  resolvedJumpHostId: string | null
  decision: ImportDecision
  /** Why this entry is a duplicate or invalid; empty for a creatable entry. */
  reason: string
  /** Pre-selected in the UI: creatable entries are, the rest are not. */
  selectedByDefault: boolean
}

export interface ImportPlan {
  candidates: ImportCandidate[]
  warnings: ParsedSshConfig['warnings']
  summary: {
    total: number
    creatable: number
    duplicates: number
    invalid: number
  }
}

/**
 * A stable id for one imported host.
 *
 * Derived from what identifies the target rather than from the file position, so
 * re-importing a file whose order changed still maps to the same rows. Kept within
 * the id shape the rest of the app uses (lowercase, dashes).
 */
export function importedHostId(host: Pick<ParsedSshHost, 'hostname' | 'port'>, username: string | null): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  return ['import', slug(host.hostname), String(host.port), slug(username ?? '')]
    .filter(part => part !== '')
    .join('-')
}

function existingKey(host: Pick<Host, 'hostname' | 'port' | 'username'>): string {
  return `${host.hostname.toLowerCase()}:${host.port}:${host.username.toLowerCase()}`
}

export interface PlanOptions {
  /** Host names the user already has, for duplicate detection by name. */
  existingHosts: Host[]
}

export function planImport(
  parsed: ParsedSshConfig,
  options: PlanOptions,
): ImportPlan {
  const byTarget = new Map<string, Host>()
  const byName = new Map<string, Host>()
  for (const existing of options.existingHosts) {
    byTarget.set(existingKey(existing), existing)
    byName.set(existing.name.toLowerCase(), existing)
  }

  const seenInFile = new Set<string>()
  const candidates: ImportCandidate[] = parsed.hosts.map(entry => {
    const username = entry.username ?? ''
    const id = importedHostId(entry, entry.username)
    const name = entry.aliases[0]

    const base = {
      id,
      name,
      hostname: entry.hostname,
      port: entry.port,
      username,
      authType: (entry.identityFile === null ? 'agent' : 'key') as Host['authType'],
      identityFile: entry.identityFile,
      proxyJump: entry.proxyJump,
      // Filled by resolveProxyJumps once every candidate is known: a jump can
      // name an entry that appears later in the file.
      resolvedJumpHostId: null,
    }

    if (!isUsableHostname(entry.hostname)) {
      return {
        ...base,
        decision: 'invalid' as const,
        reason: `"${entry.hostname}" is not an address this app can connect to.`,
        selectedByDefault: false,
      }
    }

    const targetKey = `${entry.hostname.toLowerCase()}:${entry.port}:${username.toLowerCase()}`
    if (seenInFile.has(targetKey)) {
      return {
        ...base,
        decision: 'duplicate' as const,
        reason: 'The same target appears earlier in this file.',
        selectedByDefault: false,
      }
    }
    seenInFile.add(targetKey)

    const sameTarget = byTarget.get(targetKey)
    if (sameTarget !== undefined) {
      return {
        ...base,
        decision: 'duplicate' as const,
        reason: `Already saved as "${sameTarget.name}".`,
        selectedByDefault: false,
      }
    }
    const sameName = byName.get(name.toLowerCase())
    if (sameName !== undefined) {
      return {
        ...base,
        decision: 'duplicate' as const,
        reason: `A host called "${sameName.name}" already exists.`,
        selectedByDefault: false,
      }
    }

    return {
      ...base,
      decision: 'create' as const,
      reason: '',
      selectedByDefault: true,
    }
  })

  resolveProxyJumps(candidates, parsed.hosts, parsed.warnings, options.existingHosts)

  const summary = {
    total: candidates.length,
    creatable: candidates.filter(candidate => candidate.decision === 'create').length,
    duplicates: candidates.filter(candidate => candidate.decision === 'duplicate').length,
    invalid: candidates.filter(candidate => candidate.decision === 'invalid').length,
  }

  return { candidates, warnings: parsed.warnings, summary }
}

/**
 * Builds the host rows to insert from the candidates the user selected.
 *
 * Only `create` candidates can be materialised; a duplicate needs a rename or a
 * deletion of the existing row, which is the user's decision made in the UI, not
 * something an import may decide on its own.
 */
export function materialiseImport(
  candidates: ImportCandidate[],
  selectedIds: ReadonlySet<string>,
  now = Date.now(),
): Array<Omit<Host, 'createdAt' | 'updatedAt'> & { createdAt: number; updatedAt: number }> {
  return candidates
    .filter(candidate => candidate.decision === 'create' && selectedIds.has(candidate.id))
    .map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      hostname: candidate.hostname,
      port: candidate.port,
      username: candidate.username,
      authType: candidate.authType,
      // A key path is a reference, not key material. It goes in its own field;
      // `privateKey` means PEM content and is handed to the SSH layer verbatim,
      // so a path there fails at connect time with an error that names nothing.
      identityFilePath: candidate.identityFile ?? undefined,
      // Only a resolved id may be stored. An unresolvable ProxyJump is surfaced
      // as a warning and the host is not creatable, so this cannot be an alias.
      jumpHostId: candidate.resolvedJumpHostId ?? undefined,
      isFavorite: false,
      portForwards: [],
      tags: ['imported'],
      createdAt: now,
      updatedAt: now,
    }))
}
