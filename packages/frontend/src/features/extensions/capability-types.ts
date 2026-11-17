/**
 * The capability gateway's vocabulary: capabilities, safe data shapes, denials.
 *
 * Split out of `capability-gateway.ts` for the size gate, along a seam that is real:
 * these are the types an extension's manifest and an SDK consumer import, while that
 * file is the object that decides whether a call is allowed. A consumer that only
 * needs `ExtensionCapability` should not pull in the decision logic.
 */

export const EXTENSION_CAPABILITIES = [
  'commands.register',
  'menus.register',
  'ui.right-dock',
  'terminal.read-selected',
  'session.read-events',
  'workspace.read-events',
  'transfer.read-events',
] as const

export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number]

/** What a granted context can see of a session. Never the transport. */
export interface SafeSessionRef {
  sessionId: string
  /** A display label the extension may show. No hostname unless the user sees it. */
  label: string
}

/** Selected terminal text, with the identity a later approval can be bound to. */
export interface SelectedText {
  text: string
  /** Stable identity for this selection, so an approval can name exactly it. */
  selectionId: string
  sessionId: string
}

export interface SendTextIntent {
  sessionId: string
  text: string
}

export type ApprovalResult =
  | { approved: true, token: string }
  | {
      approved: false
      reason: 'expired' | 'unknown-session' | 'no-selection' | 'not-the-selection'
    }

/** Why a gateway call was refused. Every refusal is structured. */
export type GatewayDenial =
  | 'extension-unknown'
  | 'extension-disabled'
  | 'extension-failed'
  | 'stale-generation'
  | 'capability-not-declared'
  | 'session-not-visible'
  | 'no-selection'
  | 'approval-expired'
  | 'approval-already-used'
  | 'approval-mismatch'
  | 'approval-session-changed'

export class GatewayError extends Error {
  constructor(
    readonly denial: GatewayDenial,
    message: string,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

/**
 * What the gateway needs to know about one extension.
 *
 * Supplied by the registry, not by the extension: an extension that could describe
 * its own capabilities would be able to grant itself one.
 */
export interface ExtensionGrant {
  extensionId: string
  capabilities: readonly ExtensionCapability[]
  /** Bumped on every activate. A captured older value is refused. */
  generation: number
  enabled: boolean
  failed: boolean
}

/** The host-side facts the gateway re-reads, never accepting them from a caller. */
export interface GatewayHost {
  /** The session the user can currently see. */
  visibleSessionId: () => string | null
  /** The text the user has currently selected in that session, if any. */
  selectedText: () => SelectedText | null
}

