/**
 * Which cleanup actions threw, per extension.
 *
 * ## Why this is a ledger rather than a log line
 *
 * A silent `catch` in the rollback made three different states indistinguishable from
 * the outside: everything was released, one disposer threw and the rest were attempted,
 * or one threw and stopped the others. The first is a healthy deactivation and the
 * other two are leaks — and `status` reads `disabled` in all three.
 *
 * Recording the failures per extension makes the difference observable to a caller that
 * asks, without requiring anyone to read a console.
 */
export class CleanupLedger {
  private readonly problems = new Map<string, string[]>()

  /**
   * Record the outcome of one settlement.
   *
   * An empty list clears the entry: a later clean deactivation must not keep reporting
   * an earlier one's failures, or the ledger would grow into a permanent accusation.
   */
  record(extensionId: string, problems: readonly string[]): void {
    if (problems.length === 0) {
      this.problems.delete(extensionId)
      return
    }
    this.problems.set(extensionId, [...problems])
  }

  /** The last settlement's failures. Empty means nothing threw. */
  get(extensionId: string): readonly string[] {
    return this.problems.get(extensionId) ?? []
  }
}
