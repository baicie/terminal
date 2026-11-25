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

/** The operation names Rust puts in front of a transport failure, verbatim. */
const HANDSHAKE_PHRASES = [
  'did not present a host key',
  'host-key probe failed',
  'handshake',
  'kex',
  'key exchange',
]

const KNOWN_HOSTS_PHRASES = ['known_hosts', 'known hosts']

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

  if (kind === 'invalid_input' || kind === 'key_parse_failed') return 'input'
  if (kind === 'authentication_failed') return 'jump-authentication'
  if (kind === 'known_hosts_failed' || kind === 'host_key_changed') {
    return 'known-hosts'
  }

  if (message === 'SSH startup deadline expired before the terminal became ready') {
    return 'deadline'
  }
  if (KNOWN_HOSTS_PHRASES.some(phrase => text.includes(phrase))) {
    return 'known-hosts'
  }
  /*
   * Order matters: a refused connect is reported *through* the probe's handshake
   * operation name, so testing for "handshake" first would label every closed port a
   * handshake failure. Transport phrases win.
   */
  if (UNREACHABLE_PHRASES.some(phrase => text.includes(phrase))) {
    return 'unreachable'
  }
  if (HANDSHAKE_PHRASES.some(phrase => text.includes(phrase))) {
    return 'handshake'
  }
  /*
   * `connection_failed` is the variant Rust uses for everything it could not name more
   * precisely. Unnamed, it is still a transport failure, and calling it "could not
   * verify the host key" is the misdirection this module exists to remove.
   */
  if (kind === 'connection_failed') return 'unreachable'
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
const INTERNAL_PREFIXES = [
  'connection failed: ',
  'ssh host-key connection failed: ',
  'connect host-key probe failed: ',
  'host-key probe target handshake failed: ',
  'open host-key probe tunnel failed: ',
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
