/**
 * One-shot, expiring approvals for sending text to a shell.
 *
 * Separated from the gateway because the rule it encodes is self-contained and
 * worth reading on its own: **an extension never writes to a terminal.** It asks for
 * permission, the host mints a token bound to the exact text and a deadline, the
 * *user* confirms, and only then does the host write — once. Everything else in the
 * gateway is about *who may ask*; this is about *what an answer means*.
 */

/** Default lifetime of a send-text approval. Long enough to read, short enough to matter. */
export const APPROVAL_TTL_MS = 60_000

export class ApprovalError extends Error {
  constructor(
    readonly reason: 'expired' | 'already-used' | 'mismatch',
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
  textHash: string
  expiresAt: number
  used: boolean
}

/**
 * FNV-1a over the text.
 *
 * Not a security hash — it exists so an approval names the exact bytes the user
 * saw, and a later substitution fails the comparison. A cryptographic hash would
 * suggest a tamper-resistance property this does not have or need: the text never
 * leaves the process, and the comparison is against the same in-memory value.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export class ApprovalBook {
  private readonly approvals = new Map<string, PendingApproval>()
  private nextApproval = 0

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Mint a token for this extension, activation, session and exact text. */
  mint(input: {
    extensionId: string
    generation: number
    sessionId: string
    text: string
  }): string {
    this.nextApproval += 1
    const token = `approval-${this.nextApproval}`
    this.approvals.set(token, {
      extensionId: input.extensionId,
      generation: input.generation,
      sessionId: input.sessionId,
      textHash: hashText(input.text),
      expiresAt: this.now() + APPROVAL_TTL_MS,
      used: false,
    })
    return token
  }

  /**
   * Redeem a token, returning the session it was minted for.
   *
   * Every mismatch is a refusal rather than a silent pass: a token that names a
   * different extension, a different activation or different text is not "close
   * enough", it is a different request.
   */
  consume(input: {
    token: string
    extensionId: string
    generation: number
    text: string
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
    if (
      approval.extensionId !== input.extensionId ||
      approval.generation !== input.generation ||
      approval.textHash !== hashText(input.text)
    ) {
      throw new ApprovalError('mismatch', 'That approval does not match this request.')
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
