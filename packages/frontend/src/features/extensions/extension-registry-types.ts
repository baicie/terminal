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
import type { CapabilityGateway } from './capability-gateway'
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
