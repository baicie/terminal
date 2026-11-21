/**
 * Read-only counts of what the extension registry is holding.
 *
 * ## Why this is a module and not a method on the registry
 *
 * `extension-registry.ts` was at 298 of its 300-line limit before this existed. The
 * accessor is 60 lines of comments plus a few loops, and putting it inline pushed the
 * registry over the gate — which is a fine reason on its own, but the better one is
 * that this is the only consumer of the ledgers that is not part of the lifecycle.
 *
 * Keeping it here also makes the thing it measures explicit: the registry's private
 * maps are passed in, so a reader can see that this function only reads them.
 *
 * ## What the numbers mean, and what they deliberately do not
 *
 * `contributions` / `commands` / `events` count **active** extensions only. That is
 * what a user can see, and it is also what hid a real leak: `deactivate` bumped the
 * generation before calling `rollback`, `settleOwnedContributions` only cleared when
 * the generation still matched, so `clear` never ran and both ledgers kept one bucket
 * per extension forever. The filtered counts stayed at zero and looked healthy.
 *
 * `orphanedBuckets` is the number that would have caught it: ledger entries whose
 * extension is not active. It is asserted to be zero after every disable.
 */

import type { Disposable, SafeEvent, SafeEventName } from './extension-types'
import type { ExtensionStatus } from './extension-registry-types'

/** The ledgers, as the registry holds them. Read only. */
export interface RegistryLedgerView {
  records: Map<string, { status: ExtensionStatus }>
  contributions: Map<string, ContributionsBucket>
  disposables: Map<string, Disposable[]>
}

export interface ContributionsBucket {
  commands: Map<string, unknown>
  menus: unknown[]
  views: Map<string, unknown>
  events: Map<SafeEventName, Set<unknown>>
}

export interface RegistryDiagnostics {
  extensions: number
  /** Commands, menu entries and views together, from active extensions. */
  contributions: number
  commands: number
  disposables: number
  /** Event *handlers*, not event names. */
  events: number
  approvals: number
  /** Ledger entries whose extension is not active — a leak if non-zero. */
  orphanedBuckets: number
}

/**
 * Present the registry's private contributions map as the bucket shape here.
 *
 * The registry stores a richer object than this module needs; narrowing it at the
 * boundary keeps `RegistryLedgerView` honest about being read-only, and keeps the cast
 * in one named place instead of inside the registry.
 */
export function asLedgerMap(
  source: Map<string, unknown>,
): Map<string, ContributionsBucket> {
  return source as unknown as Map<string, ContributionsBucket>
}

/**
 * Count what the registry holds.
 *
 * `activeCommandCount` is passed in rather than recomputed, because the registry's
 * own `commands()` applies the same active filter and two implementations of that
 * rule would be one too many.
 */
export function collectDiagnostics(
  ledger: RegistryLedgerView,
  approvals: number,
  activeCommandCount: number,
): RegistryDiagnostics {
  const isActive = (extensionId: string) =>
    ledger.records.get(extensionId)?.status === 'active'

  let contributions = 0
  let events = 0
  let orphanedBuckets = 0
  for (const [extensionId, bucket] of ledger.contributions) {
    if (!isActive(extensionId)) {
      orphanedBuckets += 1
      continue
    }
    contributions += bucket.commands.size
    contributions += bucket.menus.length
    contributions += bucket.views.size
    // The handlers, not the event names: a leaked listener shows as a set that keeps
    // its size after disable, which a `Map.size` count cannot see.
    for (const handlers of bucket.events.values()) events += handlers.size
  }

  let disposables = 0
  for (const [extensionId, bucket] of ledger.disposables) {
    if (!isActive(extensionId)) {
      orphanedBuckets += 1
      continue
    }
    disposables += bucket.length
  }

  return {
    extensions: ledger.records.size,
    contributions,
    commands: activeCommandCount,
    disposables,
    events,
    approvals,
    orphanedBuckets,
  }
}

/** A command an active extension registered, for the Command Palette. */
export interface ActiveCommand {
  extensionId: string
  id: string
  titleKey: string
  run: () => Promise<unknown>
}

/** Every command an active extension registered. */
export function activeCommands(ledger: RegistryLedgerView): ActiveCommand[] {
  const result: ActiveCommand[] = []
  for (const [extensionId, record] of ledger.records) {
    if (record.status !== 'active') continue
    const bucket = ledger.contributions.get(extensionId)
    if (!bucket) continue
    for (const [id, command] of bucket.commands) {
      const typed = command as ActiveCommand
      result.push({
        extensionId,
        id,
        titleKey: typed.titleKey,
        run: typed.run,
      })
    }
  }
  return result
}

/** A menu entry pointing at a command that is actually registered. */
export interface ActiveMenuItem {
  extensionId: string
  commandId: string
  titleKey: string
}

/**
 * Menu entries at `location`, from active extensions only.
 *
 * An entry whose command is not registered is dropped: it would render as a menu item
 * that does nothing, and the extension that made it is telling the user it can do
 * something it cannot.
 */
export function activeMenuItems(
  ledger: RegistryLedgerView,
  location: string,
): ActiveMenuItem[] {
  const result: ActiveMenuItem[] = []
  for (const [extensionId, record] of ledger.records) {
    if (record.status !== 'active') continue
    const bucket = ledger.contributions.get(extensionId)
    if (!bucket) continue
    for (const entry of bucket.menus) {
      const { location: at, commandId } = entry as { location: string, commandId: string }
      if (at !== location) continue
      const command = bucket.commands.get(commandId) as { titleKey: string } | undefined
      if (command) {
        result.push({ extensionId, commandId, titleKey: command.titleKey })
      }
    }
  }
  return result
}

/**
 * Deliver one safe event to every active subscriber.
 *
 * ## Why this lives here
 *
 * It only walks the ledgers and calls handlers; the one thing it needs from the
 * registry is `fail`, which is passed in so this module stays free of the lifecycle.
 *
 * ## The generation rule
 *
 * The generation is captured per emission, before any handler runs. A handler that
 * rejects after the extension was disabled and re-enabled belongs to the *old*
 * activation, and blaming the new one would disable a working extension. `fail` is
 * called only when the generation still matches — the same rule `settle-owned.ts`
 * applies to cleanup.
 */
export function emitToSubscribers(
  ledger: RegistryLedgerView,
  event: SafeEvent,
  fail: (extensionId: string, error: unknown, generation: number) => void,
): void {
  for (const [extensionId, record] of ledger.records) {
    if (record.status !== 'active') continue
    const handlers = ledger.contributions.get(extensionId)?.events.get(event.type)
    if (!handlers) continue
    const generation = (record as { generation?: number }).generation ?? 0
    const blame = (error: unknown) => {
      const current = ledger.records.get(extensionId)
      if (!current || (current as { generation?: number }).generation !== generation) return
      fail(extensionId, error, generation)
    }
    for (const handler of handlers) {
      try {
        // Not awaited: one slow handler must not delay the others, and the design
        // forbids an extension callback from blocking the shell.
        void Promise.resolve((handler as (event: SafeEvent) => unknown)(event)).catch(blame)
      } catch (error) {
        blame(error)
      }
    }
  }
}
