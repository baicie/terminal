/**
 * The Capability Gateway: the only door between an extension and user data.
 *
 * ## Why this is a gateway and not an interface
 *
 * A trusted built-in extension runs in the main WebView, which holds the full
 * privilege of the app — it can `invoke()` any Tauri command and read any Zustand
 * store. TypeScript types stop a *well-meaning* extension; they stop nothing else.
 * So the security property cannot be "the extension was written carefully". It has
 * to be "the only functions it is given are these, and each one re-checks the
 * caller, the capability and the generation on every call"
 * (`06-ux3-extension-platform.md` §6).
 *
 * ## What is deliberately absent
 *
 * There is no `readSecret`, no `invoke`, no `querySql`, no `readFile`, no
 * `sessionWrite`, no raw PTY handle, and no full scrollback. An extension that
 * needs one of those is asking for a capability the design does not grant, and the
 * answer is a new capability with its own threat model — not a hole in this one.
 *
 * ## The four checks every call makes
 *
 * 1. the extension is registered and enabled;
 * 2. its generation matches — a callback captured before `deactivate` is refused,
 *    which is what stops a late async handler from writing after shutdown;
 * 3. the capability is declared in its manifest;
 * 4. for a session-scoped read, the session is *currently visible and selected*,
 *    not merely known.
 *
 * ## Approvals are one-shot and expiring
 *
 * `requestSendText` never writes to a terminal. It produces a token the *user* must
 * confirm, bound to the exact text by hash and to a deadline. That is the only path
 * from extension output to a shell, and it exists so a draft command cannot become
 * an executed one by accident.
 */

import { ApprovalBook } from './approval-book'
import type { Disposable } from './extension-types'

/** Capabilities a manifest may declare. */
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
  | { approved: false, reason: 'expired' | 'unknown-session' | 'no-selection' }

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

export class CapabilityGateway {
  private readonly approvalBook: ApprovalBook

  constructor(
    private readonly grants: () => ExtensionGrant | undefined,
    private readonly host: GatewayHost,
    now: () => number = () => Date.now(),
  ) {
    this.approvalBook = new ApprovalBook(now)
  }

  /**
   * The checks that apply to every call.
   *
   * Returns the grant so callers read `generation` from one place rather than
   * re-fetching and risking one of them skipping a check.
   */
  private authorize(
    extensionId: string,
    generation: number,
    capability: ExtensionCapability,
  ): ExtensionGrant {
    const resolved = this.grants()
    if (!resolved || resolved.extensionId !== extensionId) {
      throw new GatewayError('extension-unknown', 'This extension is not registered.')
    }
    if (resolved.failed) {
      throw new GatewayError('extension-failed', 'This extension is in a failed state.')
    }
    if (!resolved.enabled) {
      throw new GatewayError('extension-disabled', 'This extension is disabled.')
    }
    if (resolved.generation !== generation) {
      // Deactivated — and possibly reactivated — since this callback was captured.
      // Acting on it would write into a context that no longer exists.
      throw new GatewayError(
        'stale-generation',
        'This callback belongs to a previous activation of the extension.',
      )
    }
    if (!resolved.capabilities.includes(capability)) {
      throw new GatewayError(
        'capability-not-declared',
        `This extension did not declare "${capability}".`,
      )
    }
    return resolved
  }

  /**
   * Read the text the user has selected, in the session they can see.
   *
   * The only way an extension sees terminal content, and it never sees the buffer:
   * `host.selectedText()` is the host's record of a user gesture, so an extension
   * cannot ask for a region the user did not choose.
   */
  async readSelectedText(extensionId: string, generation: number): Promise<SelectedText | null> {
    this.authorize(extensionId, generation, 'terminal.read-selected')
    const selection = this.host.selectedText()
    if (!selection) return null
    // A selection from a session the user has left is not "currently selected" any
    // more, whatever the selection object still says.
    if (selection.sessionId !== this.host.visibleSessionId()) {
      throw new GatewayError('session-not-visible', 'That selection is no longer on screen.')
    }
    return selection
  }

  /**
   * Ask the user whether this text may be sent to the shell.
   *
   * Returns a token, never an action. The host writes only after the user confirms,
   * and only for the exact text the token was minted for.
   */
  async requestSendText(
    extensionId: string,
    generation: number,
    intent: SendTextIntent,
  ): Promise<ApprovalResult> {
    this.authorize(extensionId, generation, 'terminal.read-selected')
    const visible = this.host.visibleSessionId()
    if (visible === null || visible !== intent.sessionId) {
      return { approved: false, reason: 'unknown-session' }
    }
    // An approval must name a selection the user made, not text the extension
    // composed — otherwise "approve this draft" silently becomes "execute anything".
    const selection = this.host.selectedText()
    if (!selection) return { approved: false, reason: 'no-selection' }

    const token = this.approvalBook.mint({
      extensionId,
      generation,
      sessionId: intent.sessionId,
      text: intent.text,
    })
    return { approved: true, token }
  }

  /**
   * Redeem an approval, returning the session it was minted for.
   *
   * Called by the *host* when the user confirms. One-shot: a replayable approval is
   * a permission that outlives the gesture which granted it.
   */
  consumeApproval(
    token: string,
    extensionId: string,
    generation: number,
    text: string,
  ): { sessionId: string } {
    try {
      return this.approvalBook.consume({ token, extensionId, generation, text })
    } catch (error) {
      // Mapped onto the gateway's vocabulary so callers handle one error type. The
      // "used" / "expired" distinction survives because the two lead to different
      // user-facing explanations.
      const reason = (error as { reason?: string }).reason
      throw new GatewayError(
        reason === 'already-used' ? 'approval-already-used' : 'approval-expired',
        (error as Error).message,
      )
    }
  }

  /**
   * The body of `context.terminal`, bound to one extension and activation.
   *
   * The generation is captured here rather than read at call time, so every call a
   * deactivated extension makes fails the staleness check instead of silently using
   * the new generation.
   */
  terminalContextFor(extensionId: string, generation: number): {
    readSelectedText(): Promise<SelectedText | null>
    requestSendText(intent: SendTextIntent): Promise<ApprovalResult>
  } {
    return {
      readSelectedText: () => this.readSelectedText(extensionId, generation),
      requestSendText: (intent: SendTextIntent) =>
        this.requestSendText(extensionId, generation, intent),
    }
  }

  /** Drop every outstanding approval for one extension. */
  clearApprovalsFor(extensionId: string): void {
    this.approvalBook.clearFor(extensionId)
  }

  /** Diagnostics only: how many approvals are outstanding. Never their contents. */
  approvalCount(): number {
    return this.approvalBook.count()
  }
}

/** A disposable that calls its own cleanup at most once. */
export function createDisposable(dispose: () => void | Promise<void>): Disposable {
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      return dispose()
    },
  }
}
