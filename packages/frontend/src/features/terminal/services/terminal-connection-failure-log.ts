/**
 * F18 — the one `connection_logs` row a finished terminal connection is worth.
 *
 * ## Why this did not exist
 *
 * `recordConnectionFailure` had exactly one caller, `SessionService`. The terminal does not
 * go through it — `terminal-launcher` → `startTerminalShell` is the real path — so a
 * connection started from the terminal wrote **nothing** when it failed. The Logs view
 * held every success and none of the failures, which is the half a person needs when
 * something stops working.
 *
 * ## Why the import is dynamic
 *
 * `terminal-smoke-imports.test.ts` pins an invariant this file would otherwise break: the
 * terminal binding must load **without evaluating the database module**, because the smoke
 * harness runs the real UI against an isolated fixture and a module-scope database import
 * pulls the whole sqlx/plugin graph into that path.
 *
 * A static import of `session-connection-logs` (which imports `@/service/database`) failed
 * that test immediately — measured, not anticipated. The module is therefore loaded on
 * first use, inside the promise this function already does not await. A connection that
 * succeeds never loads it at all.
 */

import type { Host } from '@/types'
import type { TerminalFailure } from './terminal-session-manager-errors'

interface LoggableRequest {
  tabType: string
  host?: Host
  jumpHost?: Host
}

/**
 * Record a terminal connection that ended without connecting.
 *
 * Only a `remote` tab has a host and a row shape the schema accepts; a local shell or a
 * serial port has nothing to record.
 *
 * Never throws and never returns a promise the caller waits on. The connection has already
 * failed; a full disk must not be able to change *how* it failed.
 */
export function recordTerminalConnectionFailure(
  request: LoggableRequest,
  failure: Pick<TerminalFailure, 'error'> & Partial<TerminalFailure>,
): void {
  const host = request.host
  if (request.tabType !== 'remote' || !host) return
  /*
   * The context is appended only when present. A direct failure has no hop, and writing
   * "target" for one is the guess SSH10 exists to prevent — the Logs view must not say
   * something the overlay does not.
   */
  const detail = [
    failure.error,
    failure.diagnosis === undefined ? null : `diagnosis=${failure.diagnosis}`,
    failure.hop === undefined ? null : `hop=${failure.hop}`,
    failure.stage === undefined ? null : `stage=${failure.stage}`,
    request.jumpHost ? 'via=jump' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' | ')
  void import('./session-connection-logs')
    .then(logs =>
      logs.recordConnectionFailure(
        {
          id: host.id,
          name: host.name,
          hostname: host.hostname,
          username: host.username,
        },
        'ssh',
        detail,
      ),
    )
    .catch(() => {
      // `recordConnectionFailure` reports its own failures; a log is never fatal.
    })
}
