/**
 * SSH19 — what the pane told the user when the connection gave up.
 *
 * Its own module because `terminal-smoke-contract.ts` is at its line limit, and because
 * this is the one part of the smoke contract that describes a *failure* — every other
 * field there describes a successful run.
 *
 * Every field is optional: a direct connection has no hop, a transport fault has no
 * stage. Absent means "not recorded", never a default that reads as "target".
 */
export interface TerminalSmokeFailureReason {
  /** The classified sentence the pane showed. Recorded, not asserted on for content. */
  message?: string
  /** The SSH11 enum: `bastion-auth-rejected`, `tunnel-failed`, … */
  diagnosis?: string
  /** SSH10: which leg of a jump chain failed. */
  hop?: string
  /** SSH10: where in the connection sequence it failed. */
  stage?: string
  /** How many attempts the ladder made before giving up. */
  attempts?: number
}
