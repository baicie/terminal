/**
 * Resolving `ProxyJump` aliases to the hosts they name.
 *
 * Split out of `import-plan.ts` so that file stays within its size limit, and
 * because this is a self-contained rule: an ssh config names a jump by *alias*,
 * we store it by *host id*, and the two are not interchangeable.
 */

import type { ParsedSshHost, SshConfigWarning } from './ssh-config-parser'
import type { ImportCandidate } from './import-plan'

/**
 * Point every `ProxyJump` at the candidate it names, or mark the entry unusable.
 *
 * OpenSSH writes a jump as an alias (`bastion`), a `user@host` pair, or a
 * `user@host:port` triple. Our `jumpHostId` column holds an internal host id.
 * The two are not interchangeable: writing the alias there creates a dangling
 * reference, and because the row still imports "successfully" the user only
 * discovers it when the connection is attempted — a failure that looks like a
 * network problem rather than an import one.
 *
 * Resolution order, matching how ssh itself behaves:
 *   1. an alias defined in this same file (the common case),
 *   2. failing that, a host already saved locally with that name or address.
 *
 * When neither matches, the entry becomes `invalid` with a reason the UI shows.
 * Silently importing it as a direct connection would be a claim we cannot keep:
 * the target may only be reachable through that bastion.
 */
export function resolveProxyJumps(
  candidates: ImportCandidate[],
  entries: ParsedSshHost[],
  warnings: SshConfigWarning[],
): void {
  if (candidates.length === 0) return

  const unresolvedJumps: ImportCandidate[] = []

  /** alias (lowercased) -> candidate id, for entries defined in this file. */
  const byAlias = new Map<string, string>()
  /** name / hostname (lowercased) -> candidate id, as a fallback. */
  const byNameOrHost = new Map<string, string>()
  for (const candidate of candidates) {
    byNameOrHost.set(candidate.name.toLowerCase(), candidate.id)
    byNameOrHost.set(candidate.hostname.toLowerCase(), candidate.id)
  }
  for (const entry of entries) {
    const owner = candidates.find(
      candidate => candidate.hostname === entry.hostname && candidate.port === entry.port,
    )
    if (owner === undefined) continue
    for (const alias of entry.aliases) {
      byAlias.set(alias.toLowerCase(), owner.id)
    }
  }

  for (const candidate of candidates) {
    if (candidate.proxyJump === null) {
      candidate.resolvedJumpHostId = null
      continue
    }
    const target = parseJumpTarget(candidate.proxyJump)
    if (target === null) {
      candidate.resolvedJumpHostId = null
      candidate.decision = 'invalid'
      candidate.reason = `ProxyJump "${candidate.proxyJump}" is not a form this importer understands.`
      candidate.selectedByDefault = false
      continue
    }
    const resolved =
      byAlias.get(target.toLowerCase()) ??
      byNameOrHost.get(target.toLowerCase()) ??
      null
    candidate.resolvedJumpHostId = resolved
    if (resolved === null) {
      candidate.decision = 'invalid'
      candidate.reason =
        `ProxyJump "${candidate.proxyJump}" names a host that is neither in this ` +
        'file nor saved locally. Import it first, or add the jump host by hand.'
      candidate.selectedByDefault = false
      unresolvedJumps.push(candidate)
    }
  }

  // Surface them as warnings too: the candidate list is one view of the import,
  // and the warning list is what the UI shows above it. A user who scans only
  // that list must still learn that a jump could not be resolved.
  for (const candidate of unresolvedJumps) {
    warnings.push({
      kind: 'unsupported-keyword',
      line: 0,
      message:
        `ProxyJump "${candidate.proxyJump}" for "${candidate.name}" could not be ` +
        'resolved to an imported or saved host.',
    })
  }
}

/**
 * The part of a `ProxyJump` value that names a host.
 *
 * Accepts `alias`, `user@alias`, `alias:port`, and `user@alias:port`. Anything
 * with a comma is a jump chain (`a,b`), which this importer does not model; it is
 * reported rather than half-parsed.
 */
export function parseJumpTarget(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.includes(',')) return null
  const withoutUser = trimmed.includes('@')
    ? trimmed.slice(trimmed.lastIndexOf('@') + 1)
    : trimmed
  // A bare IPv6 literal is ambiguous with host:port and is not something this
  // importer claims to handle.
  if (withoutUser.startsWith('[')) return null
  const colon = withoutUser.indexOf(':')
  const host = colon === -1 ? withoutUser : withoutUser.slice(0, colon)
  return host === '' ? null : host
}
