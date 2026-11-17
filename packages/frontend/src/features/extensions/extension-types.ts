/**
 * The vocabulary shared by the extension registry, the gateway and the SDK.
 *
 * Kept in its own module so `capability-gateway.ts` does not have to import the
 * registry (which would make the security boundary depend on the lifecycle code)
 * and so an SDK consumer can import the types without pulling in behaviour.
 */

export interface Disposable {
  dispose(): void | Promise<void>
}

export type ExtensionId = string

/**
 * The built-in views an extension may register into the right dock.
 *
 * A closed union, not `React.ComponentType`. The design requires that "only
 * built-in views" holds in the type system *and* at runtime; accepting a component
 * would make it a documentation claim only (`06-ux3-extension-platform.md` §2).
 */
export const BUILT_IN_VIEW_IDS = ['snippet-dock', 'server-inspector', 'ai-dock'] as const

export type BuiltInViewId = (typeof BUILT_IN_VIEW_IDS)[number]

export function isBuiltInViewId(value: unknown): value is BuiltInViewId {
  return (
    typeof value === 'string' &&
    (BUILT_IN_VIEW_IDS as readonly string[]).includes(value)
  )
}

/** Where a menu contribution may appear. */
export const MENU_LOCATIONS = [
  'terminal.context',
  'connections.context',
  'transfer.context',
] as const

export type MenuLocation = (typeof MENU_LOCATIONS)[number]

/** The events an extension may subscribe to. Read-only facts, no payloads with secrets. */
export const SAFE_EVENTS = [
  'session.connected',
  'session.disconnected',
  'workspace.changed',
  'transfer.changed',
] as const

export type SafeEventName = (typeof SAFE_EVENTS)[number]

/**
 * What an event handler receives.
 *
 * No hostname, no secret, no terminal bytes: an extension learns *that* a session
 * connected, and which id to use for a scoped request. Everything else it needs has
 * to come through a capability that re-checks it.
 */
export interface SafeEvent {
  type: SafeEventName
  sessionId?: string
  /** Millisecond timestamp. Not a session or credential identifier. */
  at: number
}
