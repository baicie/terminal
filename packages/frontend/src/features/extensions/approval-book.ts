/**
 * One-shot, expiring approvals for sending text to a shell.
 *
 * **An extension never writes to a terminal.** It asks for permission, the host mints
 * a token bound to the exact text, the exact selection and a deadline, the *user*
 * confirms, and only then does the host write — once.
 *
 * ## What an approval is bound to, and why each binding exists
 *
 * | binding | the failure it prevents |
 * | --- | --- |
 * | exact text, compared in full | the extension asks for "ls" and redeems "rm -rf /" |
 * | selection id | the same text re-highlighted elsewhere in the same session |
 * | extension id | one extension redeeming another's approval |
 * | activation generation | a token outliving the activation that minted it |
 * | session id | a write landing on a host the user is not looking at |
 * | one-shot flag | replay, which is a permission outliving the gesture |
 * | deadline | an approval found later in a log or a stale component |
 *
 * ## Why the comparison is over the full text, not a digest
 *
 * The first version compared a 32-bit FNV-1a digest over UTF-16 code units and its
 * comment argued a cryptographic hash was unnecessary because "the text never leaves
 * the process". That reasoning was wrong: the text is supplied by the *extension* on
 * both sides — it passes `intent.text` when asking and again when redeeming — so the
 * attacker is not an outsider guessing a preimage, it is the caller choosing both
 * operands. A 32-bit space makes a targeted collision routine.
 *
 * Comparing the strings directly removes the question entirely: there is no digest to
 * collide. The digest that remains is only for diagnostics, at 128 bits.
 */

import { createHash } from './hash-text'

/** Default lifetime of a send-text approval. Long enough to read, short enough to matter. */
export const APPROVAL_TTL_MS = 60_000

export class ApprovalError extends Error {
  constructor(
    readonly reason: 'expired' | 'already-used' | 'mismatch' | 'session-changed',
    message: string,
  ) {
    super(message)
    this.name = 'ApprovalError'
  }
}

interface PendingApproval {
  extensionId: string
  generation: number
  sessionId: string
  selectionId: string
  /** The exact text. Compared in full at redemption — not by digest. */
  text: string
  /** Diagnostics only. Never used for the decision. */
  digest: string
  expiresAt: number
  used: boolean
}

/**
 * A stable 128-bit digest of the text, for diagnostics and logs.
 *
 * Not used to authorise anything: authorisation compares the strings. Exported
 * because a log line benefits from a short stable fingerprint, and because a reader
 * of the old 32-bit version should be able to see the difference.
 */
export function textDigest(text: string): string {
  return createHash(text)
}

export class ApprovalBook {
  private readonly approvals = new Map<string, PendingApproval>()
  private nextApproval = 0

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Mint a token bound to this extension, activation, session, selection and text. */
  mint(input: {
    extensionId: string
    generation: number
    sessionId: string
    selectionId: string
    text: string
  }): string {
    this.nextApproval += 1
    const token = `approval-${this.nextApproval}`
    this.approvals.set(token, {
      extensionId: input.extensionId,
      generation: input.generation,
      sessionId: input.sessionId,
      selectionId: input.selectionId,
      text: input.text,
      digest: textDigest(input.text),
      expiresAt: this.now() + APPROVAL_TTL_MS,
      used: false,
    })
    return token
  }

  /**
   * Redeem a token, returning the session it was minted for.
   *
   * Every mismatch is a refusal, and the *reason* is kept: a substituted-text attempt
   * and an expired token lead to different explanations, and reporting the first as
   * the second hides an attack behind a mundane message.
   */
  consume(input: {
    token: string
    extensionId: string
    generation: number
    text: string
    selectionId: string
    visibleSessionId: string | null
  }): { sessionId: string } {
    const approval = this.approvals.get(input.token)
    if (!approval) throw new ApprovalError('expired', 'That approval does not exist.')
    if (approval.used) {
      throw new ApprovalError('already-used', 'That approval was already used.')
    }
    if (approval.expiresAt <= this.now()) {
      this.approvals.delete(input.token)
      throw new ApprovalError('expired', 'That approval has expired.')
    }
    if (approval.extensionId !== input.extensionId || approval.generation !== input.generation) {
      throw new ApprovalError('mismatch', 'That approval belongs to a different request.')
    }
    // The text is compared in full. Comparing a digest here is what the first version
    // did, and a digest over caller-chosen input is a collision away from useless.
    if (approval.text !== input.text) {
      throw new ApprovalError('mismatch', 'That approval was for different text.')
    }
    if (approval.selectionId !== input.selectionId) {
      throw new ApprovalError('mismatch', 'That approval was for a different selection.')
    }
    if (input.visibleSessionId === null || approval.sessionId !== input.visibleSessionId) {
      // The user has moved to another session. Writing here would land on a host they
      // are not watching.
      throw new ApprovalError('session-changed', 'The active session is no longer the approved one.')
    }
    approval.used = true
    this.approvals.delete(input.token)
    return { sessionId: approval.sessionId }
  }

  /** Drop every outstanding approval for one extension. */
  clearFor(extensionId: string): void {
    for (const [token, approval] of this.approvals) {
      if (approval.extensionId === extensionId) this.approvals.delete(token)
    }
  }

  /** Diagnostics only: how many are outstanding. Never their contents. */
  count(): number {
    return this.approvals.size
  }
}
