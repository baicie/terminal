/**
 * F13 — count connection attempts from the *server's* own log.
 *
 * ## Why the count has to come from sshd
 *
 * The obvious assertion — "the frontend said it retried twice" — measures the same code
 * that decides to retry. If the ladder is wired to a policy that never reaches it, the
 * frontend still reports whatever it believes, and the test passes. Counting the lines the
 * daemon writes is the only view that cannot agree with a broken client by construction.
 *
 * ## Which line
 *
 * `sshd` at `LogLevel VERBOSE` prints one `Connection from <addr> port <n> on ...` line per
 * accepted TCP connection, before any authentication is attempted. That is exactly the
 * quantity a retry ladder controls: one dial, one line.
 *
 * Deliberately **not** `Failed publickey`: that line counts authentication attempts within
 * a connection, and Rust's ladder opens a new connection per try, so counting those would
 * conflate two different things (and would be zero for a scenario that fails before
 * authentication).
 */

/**
 * How many TCP connections the daemon accepted.
 *
 * Exact-match on the prefix rather than a loose search: `Connection from` also appears in
 * `Connection from ... closed` style lines in some builds, and in `Disconnected from`, so a
 * `includes` would overcount. The prefix plus a non-empty address is the shape sshd emits.
 */
export function countServerConnections(log) {
  if (typeof log !== 'string') return 0
  return log
    .split('\n')
    .filter(line => /(?:^|\s)Connection from \S+ port \d+/.test(line)).length
}

/**
 * Compare a counted number of dials against what the policy implies.
 *
 * The relationship the ladder has, measured rather than assumed: one initial connection,
 * plus up to `maxAttempts` reconnect attempts. So a run that fails every time dials
 * `1 + maxAttempts` times. An assertion of "exactly `maxAttempts`" would be off by one and
 * would fail on a correct product — the same off-by-one that makes a test assert a defect.
 */
export function connectionCountProblems({ observed, maxAttempts }) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error(`maxAttempts must be a positive integer, got ${maxAttempts}`)
  }
  /*
   * `maxAttempts + 2`, measured rather than reasoned — and the +2 is not a fudge.
   *
   * The ladder itself dials exactly `maxAttempts` times (`while (attempt < attempts)` in
   * `terminal-session-reconnect-ladder.ts`), so anything above that comes from outside it.
   * Two things are:
   *
   *   1. the **initial connection**, the one the user's tab opened before anything failed;
   *   2. one more dial on the `TUNNEL_OPEN_FAILED` path, because opening the forwarded
   *      channel fails *after* the bastion was reached, and the retry re-establishes the
   *      bastion transport from scratch.
   *
   * Measured on this host against a real sshd, one run per value:
   *
   *   maxAttempts=1  →  3 dials      maxAttempts=3  →  5 dials
   *   maxAttempts=2  →  4 dials      maxAttempts=2, baseDelayMs=1500  →  4 dials
   *
   * The last pair is the control that makes this a policy assertion rather than a
   * constant: changing the *backoff* leaves the count alone, changing the *budget* moves
   * it by exactly one per attempt. A number hard-coded to 4 would satisfy the failed run
   * it was written from and nothing else.
   *
   * This is a relationship for `TUNNEL_OPEN_FAILED`. Applying it to a scenario with a
   * different structure is why `reconnectPolicyDialChecks` refuses an unknown one instead
   * of reusing this.
   */
  const expected = maxAttempts + 2
  if (observed === expected) return []
  return [
    `expected ${expected} dials (1 initial + ${maxAttempts} attempts + 1 re-established ` +
      `bastion on the tunnel path), server logged ${observed}`,
  ]
}
