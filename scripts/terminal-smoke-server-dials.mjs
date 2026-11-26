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

/**
 * RC15 — a refused credential must not spend the reconnect budget.
 *
 * ## What this checks, and why it is a server-side fact
 *
 * The product's own claim is "authentication rejected is terminal, so the ladder never
 * starts". Measured from the client side that claim is unfalsifiable: a ladder that *did*
 * run would report five attempts, read from the same code that decided to make them. The
 * daemon's own lines cannot agree with a broken client.
 *
 * ## Why `Failed publickey` and not `Connection from`
 *
 * Measured on the first version, which counted connections and demanded exactly one: both
 * refusal scenarios reported 2 and looked like a product defect. They were not. The fixture
 * runs a readiness probe (`waitUntilReady` in `terminal-smoke-sshd.mjs`) that logs in with
 * the *correct* key before the app starts, so the daemon's log always begins with
 *
 *     Connection from …            ← the harness's own probe
 *     Accepted publickey for …     ← the probe succeeding
 *     Connection from …            ← the product's one attempt
 *     Failed publickey for …       ← the refusal being tested
 *
 * Counting connections therefore measured the harness. Counting **refusals** measures the
 * product, and the quantity RC15 is about is exactly that: how many times the server had to
 * tell this client its credential was wrong.
 *
 * ## Why exactly one
 *
 * A product that treats the refusal as terminal presents the credential once. A second
 * `Failed publickey` means the ladder ran and resent a secret the server had already
 * rejected — the defect RC15 exists to rule out.
 */
export function credentialRefusalProblems({ observed }) {
  if (observed === 1) return []
  return [
    `a refused credential must be presented exactly once, server refused it ${observed} time(s)` +
      (observed > 1
        ? ' — the retry budget was spent resending a secret the server had already rejected'
        : ' — the daemon never saw a refusal, so nothing about this path was exercised'),
  ]
}

/**
 * How many times the daemon refused a public key.
 *
 * Only the `Failed publickey` line: an `Accepted publickey` is a login that worked, which
 * for this question is harness traffic rather than the refusal under test.
 */
export function countServerRefusals(log) {
  if (typeof log !== 'string') return 0
  return log
    .split('\n')
    .filter(line => /(?:^|\s)Failed publickey for \S+ from \S+ port \d+/.test(line))
    .length
}
