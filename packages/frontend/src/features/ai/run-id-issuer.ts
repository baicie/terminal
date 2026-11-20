/**
 * Handing out request ids that are unique for the life of the runner.
 *
 * ## Why the caller's id is not enough
 *
 * `requestId` is the run id, and the run id comes from the caller (`nextRunId`). A
 * counter reset, an id resumed after a reload, or a future change to the id scheme all
 * produce a collision — and `cancel(requestId)` then addresses whichever backend
 * request holds that id, not the one the user is looking at.
 *
 * Measured before this existed: two runs both received `run-same`, and the second
 * cancel addressed the first one's request.
 *
 * The issuer keeps the caller's value as a prefix so logs still correlate, and only
 * adds a suffix when it has to.
 */
export class RunIdIssuer {
  private readonly issued = new Set<string>()

  /**
   * A request id no earlier run has used.
   *
   * Bounded by the number of runs in one session — the set lives with the runner, so a
   * long-lived page grows it by one short string per request.
   */
  next(minted: string): string {
    let id = minted
    for (let suffix = 2; this.issued.has(id); suffix += 1) {
      id = `${minted}#${suffix}`
    }
    this.issued.add(id)
    return id
  }

  /** How many ids have been issued. For diagnostics and tests. */
  size(): number {
    return this.issued.size
  }
}
