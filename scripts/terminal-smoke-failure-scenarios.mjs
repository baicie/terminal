/**
 * F09 — the failure scenarios the smoke harness can orchestrate, stated in one table.
 *
 * ## Why this is a table and not another auth mode
 *
 * SSH19 proved one failure: a direct connection to a host that never answers. `--auth`
 * selects how the product *authenticates*; a failure scenario is a different axis — it
 * says which side of a connection is broken and what the product must say about it.
 * Folding that into `--auth` would have made `--auth jump` mean two things at once.
 *
 * ## Every expectation here is a claim about the product, not about this script
 *
 * `kind` / `hop` / `stage` / `diagnosis` mirror what `classifyTerminalFailure` and
 * `diagnoseFailure` produce from the Rust `SessionFailure`. They are asserted, not
 * assumed: a scenario whose terminal reports something else fails the run. `retryable`
 * is likewise recorded so a scenario that starts retrying a credential refusal is caught
 * rather than silently absorbed into a longer run.
 *
 * ## What each scenario sets up
 *
 *   DIRECT_UNREACHABLE        port 1 on loopback — nothing listening, refused immediately
 *   BASTION_UNREACHABLE       bastion host key unusable by the target's reachable port
 *   BASTION_AUTH_REJECTED     the bastion's authorized_keys does not contain our key
 *   TARGET_AUTH_REJECTED      the bastion forwards, the target refuses our key
 *   BASTION_HOST_KEY_REJECTED the config pins a host key the bastion does not present
 *   TARGET_HOST_KEY_REJECTED  the bastion is fine, the target's pin is wrong
 *   TUNNEL_OPEN_FAILED        the bastion refuses `direct-tcpip` to the target port
 *
 * The distinction that matters most: `*_AUTH_REJECTED` is terminal (`retryable: false`)
 * and `*_UNREACHABLE` / `TUNNEL_OPEN_FAILED` are transient. A product that retried the
 * former five times would be spending a budget to be refused five more times.
 */

/** Every scenario this harness can orchestrate, in the order a report lists them. */
export const FAILURE_SCENARIOS = [
  'DIRECT_UNREACHABLE',
  'BASTION_UNREACHABLE',
  'BASTION_AUTH_REJECTED',
  'TARGET_AUTH_REJECTED',
  'BASTION_HOST_KEY_REJECTED',
  'TARGET_HOST_KEY_REJECTED',
  'TUNNEL_OPEN_FAILED',
]

/**
 * The contract each scenario is measured against.
 *
 * `diagnosis` is the SSH11 enum the pane renders. `hop`/`stage` are only meaningful for
 * jump scenarios; a direct connection has neither and the assertion below records that
 * rather than leaving it implicit.
 */
export const FAILURE_EXPECTATIONS = {
  DIRECT_UNREACHABLE: {
    jump: false,
    kind: 'connection_failed',
    retryable: true,
    hop: undefined,
    diagnosis: undefined,
    targetMustReceiveConnection: false,
  },
  BASTION_UNREACHABLE: {
    jump: true,
    /*
     * The bastion's config is written (so the product has a jump host to dial) but its
     * daemon is stopped, exactly like `DIRECT_UNREACHABLE` does for the target. No host
     * key is ever exchanged, so no hop is claimed: the product never reached a machine to
     * blame.
     */
    kind: 'connection_failed',
    retryable: true,
    hop: undefined,
    diagnosis: undefined,
    targetMustReceiveConnection: false,
  },
  BASTION_AUTH_REJECTED: {
    jump: true,
    kind: 'authentication_rejected',
    retryable: false,
    hop: 'bastion',
    stage: 'authentication',
    diagnosis: 'bastion-auth-rejected',
    targetMustReceiveConnection: false,
  },
  TARGET_AUTH_REJECTED: {
    jump: true,
    kind: 'authentication_rejected',
    retryable: false,
    hop: 'target',
    stage: 'authentication',
    diagnosis: 'target-auth-rejected',
    targetMustReceiveConnection: true,
  },
  BASTION_HOST_KEY_REJECTED: {
    jump: true,
    kind: 'host_key_rejected',
    retryable: false,
    hop: 'bastion',
    stage: 'host_key_verification',
    diagnosis: 'bastion-host-key-rejected',
    targetMustReceiveConnection: false,
  },
  TARGET_HOST_KEY_REJECTED: {
    jump: true,
    kind: 'host_key_rejected',
    retryable: false,
    hop: 'target',
    stage: 'host_key_verification',
    diagnosis: 'target-host-key-rejected',
    targetMustReceiveConnection: true,
  },
  TUNNEL_OPEN_FAILED: {
    jump: true,
    // The bastion refused `direct-tcpip`; no credential was ever presented.
    kind: 'connection_failed',
    retryable: true,
    /*
     * `hop` **is** `bastion`, and the first version of this table said `undefined` — the
     * table was wrong, not the product.
     *
     * Two different fields are in play and I conflated them:
     *
     *   * the record's `hop`, which Rust sets to `Bastion` because that is the connection
     *     holding the `direct-tcpip` channel (`ssh.rs:2110`), and which the frontend
     *     carries through unchanged;
     *   * the *diagnosis*, which `diagnoseFailure` decides from the stage alone —
     *     `if (stage === 'tunnel_open') return 'tunnel-failed'` (`terminal-failure-
     *     diagnostic.ts:97`) — precisely so the pane does not blame a machine it cannot
     *     identify.
     *
     * Measured on a real run: the terminal reported `hop: "bastion"`, and the
     * comparison rejected it, so a correct product failed a wrong expectation. The hop is
     * honest here (the bastion is the peer that refused), and the *user-facing* message
     * is still the hop-free `tunnel-failed`.
     */
    hop: 'bastion',
    stage: 'tunnel_open',
    diagnosis: 'tunnel-failed',
    targetMustReceiveConnection: false,
  },
}

/** Throwing validation, so a typo in a scenario name fails before any daemon starts. */
export function assertKnownScenario(scenario) {
  if (!FAILURE_SCENARIOS.includes(scenario)) {
    throw new Error(
      `unknown failure scenario ${JSON.stringify(scenario)}; expected one of ${FAILURE_SCENARIOS.join(', ')}`,
    )
  }
  return scenario
}

/**
 * Check what the terminal reported against the scenario's contract.
 *
 * Returns a list of problems, empty when the observation matches. The caller decides how
 * to report them; this stays a pure function so the table above can be tested without a
 * daemon.
 *
 * `undefined` and an absent field are the same thing here on purpose: the smoke result
 * omits optional fields rather than writing `null`, and a direct connection genuinely has
 * no hop.
 */
export function compareFailureObservation(scenario, observation) {
  const expected = FAILURE_EXPECTATIONS[assertKnownScenario(scenario)]
  const problems = []
  const observed = {
    hop: observation.hop ?? undefined,
    stage: observation.stage ?? undefined,
    diagnosis: observation.diagnosis ?? undefined,
  }
  for (const field of ['hop', 'stage', 'diagnosis']) {
    if (observed[field] === expected[field]) continue
    problems.push(
      `${scenario}: expected ${field} ${JSON.stringify(expected[field] ?? null)}, ` +
        `observed ${JSON.stringify(observed[field] ?? null)} — the pane would name ` +
        'a different machine or step than the one that actually failed',
    )
  }
  if (observation.diagnosis !== undefined && expected.diagnosis === undefined) {
    problems.push(
      `${scenario}: a diagnosis was reported where the raw message is the honest answer`,
    )
  }
  /*
   * `attempts` is deliberately not compared to an expected count. SSH19 established that
   * the field is `null` unless the terminal actually counted; filling in the configured
   * `maxAttempts` would make the report claim a measurement nobody took.
   */
  return problems
}
