/**
 * The registry's vocabulary, its bookkeeping and its timing helpers.
 *
 * Split out of `extension-registry.ts` for the size gate, along a seam that is real:
 * these are the shapes a settings page and the capability gateway read, while that
 * file is the state machine that produces them. `track` sits next to the
 * `Contributions` it maintains so "every registration must be disposable" is
 * readable in one place.
 */

import { createDisposable } from './capability-gateway'
import type { CapabilityGateway, ExtensionCapability } from './capability-gateway'
import type { Disposable, SafeEvent, SafeEventName } from './extension-types'
import type { BuiltInExtensionManifest, ExtensionPlatform } from './extension-manifest'

export type ExtensionStatus =
  | 'registered'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'disabled'
  | 'failed'

/**
 * The activation budget.
 *
 * An extension that hangs in `activate` must not hang the shell, so activation is
 * abandoned after this long and the extension moves to `failed`. Generous enough
 * that a slow synchronous registration is not punished.
 */
export const ACTIVATION_BUDGET_MS = 5_000

/** What the registry hands an extension at activation. */
export interface ExtensionContext {
  extensionId: string
  apiVersion: 1
  /** The extension's own bucket. Every registration goes through it. */
  subscriptions: Disposable[]
  commands: {
    register(def: {
      id: string
      titleKey: string
      run(): Promise<unknown>
    }): Disposable
  }
  menus: {
    register(def: { location: string, commandId: string }): Disposable
  }
  views: {
    register(def: { id: string, titleKey: string }): Disposable
  }
  events: {
    on(event: SafeEventName, handler: (event: SafeEvent) => void | Promise<void>): Disposable
  }
  /** Bound to this activation; every call re-checks the generation. */
  terminal: ReturnType<CapabilityGateway['terminalContextFor']>
}

/** A command as the Command Palette sees it. */
export interface ExtensionCommand {
  extensionId: string
  id: string
  titleKey: string
  run(): Promise<unknown>
}

export interface ExtensionRecord {
  manifest: BuiltInExtensionManifest
  status: ExtensionStatus
  /** Bumped on every activation. A callback from an older value is refused. */
  generation: number
  /** Why it failed, if it did. Never contains extension-supplied text or secrets. */
  failure?: string
}

/** The registrations one extension made, so deactivation can settle them. */
/** One menu entry an active extension contributed, ready for a host to render. */
export interface ExtensionMenuItem {
  extensionId: string
  commandId: string
  titleKey: string
}

export interface Contributions {
  commands: Map<string, { id: string, titleKey: string, run(): Promise<unknown> }>
  menus: Array<{ location: string, commandId: string }>
  views: Map<string, { id: string, titleKey: string }>
  events: Map<SafeEventName, Set<(event: SafeEvent) => void | Promise<void>>>
}

export interface ExtensionRegistryOptions {
  platform?: ExtensionPlatform
  /** Enables/disables persistence. Injected so the registry owns no storage. */
  isEnabled?(extensionId: string): boolean
  setEnabled?(extensionId: string, enabled: boolean): void
  onChanged?(): void
}

export function emptyContributions(): Contributions {
  return {
    commands: new Map(),
    menus: [],
    views: new Map(),
    events: new Map(),
  }
}

export function addHandler(
  contributions: Contributions,
  event: SafeEventName,
  handler: (event: SafeEvent) => void | Promise<void>,
): void {
  const existing = contributions.events.get(event)
  if (existing) existing.add(handler)
  else contributions.events.set(event, new Set([handler]))
}

/**
 * Record a contribution and make its removal disposable.
 *
 * One helper for all four surfaces: a registration that is created but not tracked
 * is exactly the leak deactivation exists to prevent, and four copies of that rule
 * is four chances to forget it.
 */
export function track(bucket: Disposable[], dispose: () => void): Disposable {
  const disposable = createDisposable(dispose)
  bucket.push(disposable)
  return disposable
}

/** Reject after `ms` rather than waiting for a factory that may never settle. */
export function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`activation exceeded its ${ms}ms budget`)),
      ms,
    )
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Refuse a registration the manifest did not declare.
 *
 * Throws rather than ignoring: an extension whose registration silently vanished is
 * a feature that does not work for a reason nobody can see. A throw during activation
 * rolls the whole extension back and reports why.
 */
export function requireCapability(
  declared: ReadonlySet<string>,
  capability: ExtensionCapability,
  extensionId: string,
): void {
  if (!declared.has(capability)) {
    throw new Error(
      `extension "${extensionId}" did not declare the "${capability}" capability`,
    )
  }
}

/** Which read-event capability covers this event. */
export function eventCapability(event: SafeEventName): ExtensionCapability {
  if (event === 'session.connected' || event === 'session.disconnected') {
    return 'session.read-events'
  }
  if (event === 'workspace.changed') return 'workspace.read-events'
  return 'transfer.read-events'
}

export function buildExtensionContext(input: {
  record: ExtensionRecord
  generation: number
  contributions: Contributions
  bucket: Disposable[]
  terminal: ExtensionContext['terminal'] | undefined
}): ExtensionContext {
  const { contributions, bucket } = input
  const record = input.record
  const declared = new Set<string>(record.manifest.capabilities)
  return {
      extensionId: record.manifest.id,
      apiVersion: 1,
      subscriptions: bucket,
      commands: {
        register: def => {
          requireCapability(declared, 'commands.register', record.manifest.id)
          contributions.commands.set(def.id, def)
          return track(bucket, () => contributions.commands.delete(def.id))
        },
      },
      menus: {
        register: def => {
          requireCapability(declared, 'menus.register', record.manifest.id)
          contributions.menus.push(def)
          return track(bucket, () => {
            const index = contributions.menus.indexOf(def)
            if (index >= 0) contributions.menus.splice(index, 1)
          })
        },
      },
      views: {
        register: def => {
          requireCapability(declared, 'ui.right-dock', record.manifest.id)
          contributions.views.set(def.id, def)
          return track(bucket, () => contributions.views.delete(def.id))
        },
      },
      events: {
        on: (event, handler) => {
          // The three read-event capabilities are declared separately, and until now
          // nothing checked them: an extension that declared only `commands.register`
          // could subscribe to session facts anyway. The manifest is the declaration
          // the whole platform is reviewed against; a registration that ignores it
          // makes the manifest decorative.
          requireCapability(declared, eventCapability(event), record.manifest.id)
          addHandler(contributions, event, handler)
          return track(bucket, () => {
            contributions.events.get(event)?.delete(handler)
          })
        },
      },
      terminal: input.terminal ?? noGatewayTerminal(),
    }
  }

/** The terminal context when no gateway is attached: refuse everything. */
function noGatewayTerminal(): ExtensionContext['terminal'] {
  const refuse = async (): Promise<never> => {
    throw new Error('the capability gateway is not attached')
  }
  return { readSelectedText: refuse, requestSendText: refuse }
}
