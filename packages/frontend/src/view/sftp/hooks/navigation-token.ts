/**
 * Which directory listing the user is actually waiting for.
 *
 * ## Why a host generation is not enough
 *
 * `generationRef` moves only when the *host* changes. Two listings on the same session
 * therefore share it, so the slower one wins simply by finishing later — measured:
 * navigate to a slow `/a`, then a fast `/b`, and `/a` lands after `/b` and puts the
 * user back in the directory they left, with no indication anything went wrong.
 *
 * A counter per navigation is the smallest thing that tells those apart. It does not
 * replace the host guard: the caller still compares generation and host key, and this
 * answers the additional question "is this the newest listing?".
 */
export interface NavigationTicket {
  /** Monotonic per listing, so two on the same host are distinguishable. */
  readonly navigation: number
  /** The host generation this listing belongs to. */
  readonly generation: number
  /** The host identity this listing belongs to. */
  readonly hostKey: string | null
}

export interface NavigationTracker {
  /** Claim a ticket for a listing that is about to start. */
  next(generation: number, hostKey: string | null): NavigationTicket
  /** The newest ticket issued, or 0 before any. */
  newest(): number
  /** Move the counter past every outstanding ticket. */
  invalidate(): void
}

export function createNavigationTracker(): NavigationTracker {
  let counter = 0
  return {
    next(generation, hostKey) {
      counter += 1
      return { navigation: counter, generation, hostKey }
    },
    newest() {
      return counter
    },
    invalidate() {
      counter += 1
    },
  }
}

/**
 * Whether a ticket still describes what the user is waiting for.
 *
 * Both halves matter: a listing from the previous host is stale even if it happens to
 * be the newest ticket, and a listing superseded by a later navigation is stale even
 * on the same host.
 */
export function isTicketCurrent(
  ticket: NavigationTicket,
  tracker: NavigationTracker,
  generation: number,
  hostKey: string | null,
): boolean {
  return (
    ticket.navigation === tracker.newest() &&
    ticket.generation === generation &&
    ticket.hostKey === hostKey
  )
}
