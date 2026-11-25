/**
 * Which step of the preflight failed, in the user's terms rather than the transport's.
 *
 * ## The defect this replaces
 *
 * The gate overlay had one sentence for every failure: "Could not verify the SSH host
 * key". Measured on a macOS GUI run against a closed port, the pane therefore said
 *
 *     Could not verify the SSH host key
 *     connection failed: connect host-key probe failed: Connection refused (os error 61)
 *
 * The user's machine never answered a TCP connect. Nothing was verified, nothing was
 * compared, and the advice the sentence implies — go and look at `known_hosts` — sends
 * them to the one place that is certainly fine. The second line is three layers of
 * internal vocabulary stacked on each other.
 *
 * ## Why the decision is here and not in Rust
 *
 * The Rust probe already distinguishes its failures: `SshHostKeyError` carries six
 * variants and `map_session_error` keeps `InvalidInput`, `AuthenticationFailed` and the
 * parse failures apart. What it cannot say is which of them a *person* needs to act on,
 * because that depends on the question the gate was asking. So the wire keeps its
 * structure and this module names the step.
 *
 * ## Why the raw message is still shown
 *
 * The classification chooses the headline and decides whether the raw detail is worth
 * a line of its own. It never rewrites the detail into something friendlier: an error
 * the user has to search for is more useful verbatim than one paraphrased away.
 */

/** The step the preflight was on when it failed. */
export type SshHostKeyGateFailure =
  /** The machine never answered: refused, unreachable, timed out, name not resolved. */
  | 'unreachable'
  /** The machine answered, but not with an SSH host key we could read. */
  | 'handshake'
  /** A bastion's credential was refused before the target could be reached. */
  | 'jump-authentication'
  /** known_hosts could not be read or written. */
  | 'known-hosts'
  /** The probe never ran: the startup deadline went first. */
  | 'deadline'
  /** A local input problem: bad host name, unparsable key material. */
  | 'input'
  /**
   * The connection could not be attempted at all: the row is incomplete, or it points
   * at a jump host that no longer exists.
   *
   * Reachable without any network: deleting a bastion leaves every host that referenced
   * it with a dangling `jumpHostId`, because the column has no foreign key and nothing
   * clears it. Those hosts then rendered "Could not verify the SSH host key" — the one
   * sentence this round exists to stop showing for a problem it does not describe.
   */
  | 'configuration'

/**
 * Phrases that mean "the connection never got an answer".
 *
 * Matched against the lowercased message because that is all a JS-side error carries:
 * `invoke` rejects with `{ type, message }` for our own commands, but a transport-level
 * failure arrives as a plain `Error` whose only structure is its text. The list is the
 * union of what the Rust layer and the two desktop platforms actually emit, taken from
 * the existing retry classifier rather than invented here.
 */
const UNREACHABLE_PHRASES = [
  'connection refused',
  'connection reset',
  'connection closed',
  'connection aborted',
  'connection timed out',
  'timed out',
  'timeout',
  'forcibly closed',
  'actively refused',
  'no connection could be made',
  'semaphore timeout',
  'no route to host',
  'host unreachable',
  'network is unreachable',
  'network unavailable',
  'network offline',
  'no such host',
  'name or service not known',
  'nodename nor servname',
  'temporary failure in name resolution',
  'failed to resolve',
  'host could not be resolved',
  'broken pipe',
  'transport closed',
]

/**
 * The one handshake symptom worth naming.
 *
 * The first version also listed the probe's own operation names here (`host-key probe
 * failed`, `handshake`, `kex`). Those never decided anything: every message carrying
 * them also carried a transport phrase, and the transport branch is tested first — so
 * the list was a second, unreachable opinion about the same messages. What survives is
 * the phrase Rust emits for a server that completed a connection and presented no key,
 * which nothing else catches.
 */
const NO_HOST_KEY_PHRASE = 'did not present a host key'

const KNOWN_HOSTS_PHRASES = ['known_hosts', 'known hosts']

/**
 * A credential the jump host evaluated and refused.
 *
 * ## Why this has to be prose, and what that costs
 *
 * `SessionError::AuthenticationRejected` is the terminal "the server said no" variant.
 * `ssh_host_key.rs::map_session_error` keeps three variants and flattens **everything
 * else** into `ConnectionFailed` — including `AuthenticationRejected`. So every real
 * jump-credential refusal arrives here as `type: 'connection_failed'` carrying
 *
 *     connection failed: authentication rejected: the jump host rejected authentication
 *
 * and the `authentication_failed` branch below — which was written for this case —
 * can only fire for the variant Rust produces when *no credential was supplied at all*.
 * Measured against the Rust producers: `ssh.rs:2763`, `ssh.rs:3957`.
 *
 * The honest fix is on the wire (map `AuthenticationRejected` to its own
 * `SshHostKeyError` variant); until then this list is the only thing that can tell a
 * refused credential from a dead socket, and a phrase list is exactly the fragility
 * this module was written to avoid. Recorded rather than hidden.
 */
const JUMP_AUTHENTICATION_PHRASES = [
  'authentication rejected',
  'jump host rejected authentication',
  'jump host password required',
  'no authentication method provided',
  'credentials rejected',
  'permission denied',
  'all methods rejected',
]

/**
 * The server answered and its identity was refused.
 *
 * A bastion whose recorded key no longer matches is *not* an unreachable machine: the
 * connection completed and was deliberately blocked. Telling the user "the server did
 * not answer" for this is the same misdirection as the wrong host-key sentence this
 * module replaces, only pointed at a different machine.
 *
 * These arrive as `connection_failed` too (`SessionError::HostKeyRejected` is another
 * of the variants `map_session_error` flattens): `types.rs:124`, `state.rs:426`.
 */
const HOST_KEY_REFUSAL_PHRASES = [
  'host key rejected',
  'does not match the preflight key',
  'host key verification failed',
]

/**
 * Classify a rejected probe.
 *
 * `kind` is the structured `type` field when the rejection is one of our own commands
 * (`SshHostKeyError` is a tagged enum on the wire), so the common cases never depend on
 * prose. The text branches exist for the transport-level rejections that carry no tag.
 */
export function classifySshHostKeyGateFailure(
  error: unknown,
  message: string,
): SshHostKeyGateFailure {
  const record =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : undefined
  const kind = record?.type ?? record?.kind
  const text = message.toLowerCase()

  /*
   * ## Order, and why it is this order
   *
   * Structure first, then the phrases that describe a *decision* the server made, then
   * transport symptoms, then the two remaining structural buckets.
   *
   * A decision must be read before a symptom because the two co-occur: a jump host that
   * rejected a credential is reported through a wrapper that also mentions the
   * connection. A transport phrase test alone would answer "unreachable" for a machine
   * that answered — which is the defect this module exists to remove, one machine over.
   */
  if (kind === 'invalid_input' || kind === 'key_parse_failed') return 'input'
  if (kind === 'known_hosts_failed' || kind === 'host_key_changed') {
    return 'known-hosts'
  }
  if (message === 'SSH startup deadline expired before the terminal became ready') {
    return 'deadline'
  }
  if (text.includes(NO_HOST_KEY_PHRASE)) {
    return 'handshake'
  }

  if (KNOWN_HOSTS_PHRASES.some(phrase => text.includes(phrase))) {
    return 'known-hosts'
  }
  if (HOST_KEY_REFUSAL_PHRASES.some(phrase => text.includes(phrase))) {
    return 'known-hosts'
  }
  if (
    kind === 'authentication_failed' ||
    JUMP_AUTHENTICATION_PHRASES.some(phrase => text.includes(phrase))
  ) {
    return 'jump-authentication'
  }

  /*
   * Transport symptoms come after the decisions above, and before the handshake
   * operation names: a refused connect is reported *through* the probe's handshake
   * operation, so testing for "handshake" first would label every closed port a
   * handshake failure.
   */
  if (UNREACHABLE_PHRASES.some(phrase => text.includes(phrase))) {
    return 'unreachable'
  }

  /*
   * ## The default is `handshake`, not `unreachable`
   *
   * `connection_failed` is the variant Rust uses for everything it could not name more
   * precisely, so it says nothing about whether the machine answered. Both defaults
   * are therefore guesses, and they are not equally wrong:
   *
   *   - `unreachable` claims the network got no answer. A non-SSH service behind a
   *     tunnel, a KEX failure, or a flattened variant all become "the server did not
   *     answer" — a claim about a machine that demonstrably did.
   *   - `handshake` claims only that we did not get a usable host key, which is true
   *     of every failure that reaches this line.
   *
   * The honest default is the weaker claim.
   */
  return 'handshake'
}

/**
 * The internal operation prefixes Rust puts in front of a transport error.
 *
 * `connection failed: connect host-key probe failed: Connection refused (os error 61)`
 * has one useful clause in it. The first two are our own call stack. Stripped here, at
 * the single point where the gate turns a rejection into text, so every surface that
 * shows this error benefits and none has to know the prefixes.
 */
/*
 * ## Only prefixes that actually lead a user-facing rejection
 *
 * `host-key probe target handshake failed:` and `open host-key probe tunnel failed:`
 * were listed here and never occur at the start of one: Rust passes both as the
 * `operation` label to `disconnect_and_wait_with_shutdown`, which logs them and does
 * not put them in the error. Removing them keeps this list honest — a prefix nobody
 * can produce reads like coverage that does not exist.
 */
const INTERNAL_PREFIXES = [
  'connection failed: ',
  'ssh host-key connection failed: ',
  'connect host-key probe failed: ',
]

/** The message with this repository's own operation names removed, and nothing else. */
export function humaniseSshHostKeyGateError(message: string): string {
  let text = message.trim()
  // Repeatedly, because the prefixes nest: connection failed → probe failed → cause.
  let changed = true
  while (changed) {
    changed = false
    const lower = text.toLowerCase()
    for (const prefix of INTERNAL_PREFIXES) {
      if (lower.startsWith(prefix)) {
        text = text.slice(prefix.length)
        changed = true
        break
      }
    }
  }
  return text.length > 0 ? text : message
}
