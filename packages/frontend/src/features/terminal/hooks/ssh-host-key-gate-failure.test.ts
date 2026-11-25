/**
 * F19/F22 — the preflight overlay must name the step that failed.
 *
 * ## The failure this pins
 *
 * Measured on a macOS GUI run: a host pointed at a closed port produced
 *
 *     Could not verify the SSH host key
 *     connection failed: connect host-key probe failed: Connection refused (os error 61)
 *
 * Three things are wrong there and only one of them is cosmetic. The headline sends
 * the user to `known_hosts` for a machine that never opened a socket; the detail line
 * is this repository's call stack; and neither says "the server is not running", which
 * is the only actionable fact in the whole message.
 *
 * ## What is asserted, and what deliberately is not
 *
 * The classification is asserted on real rejection shapes — the tagged
 * `SshHostKeyError` DTOs that `invoke` rejects with, and the untagged transport errors
 * that the two desktop platforms produce — not on a paraphrase of them. The message
 * humaniser is asserted to remove only this repository's own prefixes: a test that
 * accepted any string would pass on a version that swallowed the cause entirely.
 */

import { describe, expect, it } from 'vitest'
import {
  classifySshHostKeyGateFailure,
  humaniseSshHostKeyGateError,
} from './ssh-host-key-gate-failure'
import { SSH_HOST_KEY_FAILURE_KEYS } from '../components/terminal-container/ssh-host-key-failure-keys'

/** What `invoke` rejects with for our own commands: `{ type, message }`. */
function tagged(type: string, message: string) {
  return { type, message }
}

describe('classifying a failed SSH host-key preflight', () => {
  it('calls a refused TCP connect "the server did not answer"', () => {
    // The exact shape from the macOS GUI run that motivated this module.
    const rejection = tagged(
      'connection_failed',
      'connection failed: connect host-key probe failed: Connection refused (os error 61)',
    )
    expect(
      classifySshHostKeyGateFailure(rejection, rejection.message),
    ).toBe('unreachable')
  })

  it.each([
    ['macOS', 'Connection refused (os error 61)'],
    ['Linux', 'Connection refused (os error 111)'],
    ['Windows', 'No connection could be made because the target machine actively refused it. (os error 10061)'],
    ['timeout', 'connect host-key probe failed: timed out before its deadline'],
    ['DNS', 'failed to lookup address information: nodename nor servname provided'],
    ['routing', 'No route to host (os error 65)'],
  ])('treats a %s transport failure as unreachable', (_platform, text) => {
    expect(classifySshHostKeyGateFailure(tagged('connection_failed', text), text)).toBe(
      'unreachable',
    )
  })

  /*
   * ## The three shapes that made the first version wrong
   *
   * All three reach the gate as `type: 'connection_failed'`, because
   * `ssh_host_key.rs::map_session_error` keeps three variants and flattens the rest.
   * The first version read `connection_failed` with no transport phrase as
   * `unreachable`, so each of these told the user a machine that answered never did.
   *
   * The strings are the Rust producers verbatim — `ssh.rs:2763`, `ssh.rs:3957`,
   * `types.rs:124` + `state.rs:426`, `ssh_host_key.rs:404`.
   */
  it.each([
    [
      'a jump host that refused the credential',
      'connection failed: authentication rejected: the jump host rejected authentication',
      'jump-authentication',
    ],
    [
      'a jump host that was given no credential',
      'authentication failed: Jump host password required',
      'jump-authentication',
    ],
    [
      'a bastion whose recorded key no longer matches',
      'connection failed: host key rejected: host key verification failed for example.test:22: server key does not match the preflight key',
      'known-hosts',
    ],
    [
      'a target behind a tunnel that is not an SSH server',
      'connection failed: could not inspect 10.0.0.5:80 through the jump host: inspect host key through jump host failed: invalid SSH version string',
      'handshake',
    ],
  ])('names %s', (_label, text, expected) => {
    expect(classifySshHostKeyGateFailure(tagged('connection_failed', text), text)).toBe(
      expected,
    )
  })

  /*
   * The default is the weaker claim. `connection_failed` says nothing about whether the
   * machine answered, so an unrecognised message must not assert that it did not: the
   * old default called every unnamed failure "the server did not answer".
   */
  it('defaults an unnamed connection failure to handshake, not unreachable', () => {
    const text = 'connection failed: something this classifier has never seen'
    expect(classifySshHostKeyGateFailure(tagged('connection_failed', text), text)).toBe(
      'handshake',
    )
  })

  it('separates "answered but no usable host key" from "never answered"', () => {
    const text = 'connection failed: server 10.0.0.5:22 did not present a host key'
    expect(classifySshHostKeyGateFailure(tagged('connection_failed', text), text)).toBe(
      'handshake',
    )
  })

  it('names a refused jump-host credential rather than the transport', () => {
    const rejection = tagged('authentication_failed', 'credentials rejected by server')
    expect(
      classifySshHostKeyGateFailure(rejection, rejection.message),
    ).toBe('jump-authentication')
  })

  it('keeps a known_hosts failure out of the network story', () => {
    const rejection = tagged('known_hosts_failed', 'permission denied writing known_hosts')
    expect(
      classifySshHostKeyGateFailure(rejection, rejection.message),
    ).toBe('known-hosts')
  })

  it('names the startup deadline, which is not a network failure at all', () => {
    const text = 'SSH startup deadline expired before the terminal became ready'
    expect(classifySshHostKeyGateFailure(undefined, text)).toBe('deadline')
  })

  it('reports an input problem as input, not as an unreachable server', () => {
    const rejection = tagged('invalid_input', 'port must be between 1 and 65535')
    expect(classifySshHostKeyGateFailure(rejection, rejection.message)).toBe('input')
  })

  /*
   * The structured tag has to win over the text, or a message that happens to contain
   * "timed out" would relabel an input error as a network one. This is the same
   * invariant the failure classifier keeps: structure decides, prose never does.
   */
  it('prefers the structured kind over words in the message', () => {
    const rejection = tagged('invalid_input', 'host timed out while being parsed')
    expect(classifySshHostKeyGateFailure(rejection, rejection.message)).toBe('input')
  })

  /*
   * The structural kinds that carry their own meaning must still win over a transport
   * word in the same message: a `known_hosts_failed` that happens to say "timed out"
   * is a known_hosts problem, and an `authentication_failed` that says "connection
   * reset" is a credential refusal.
   */
  it.each([
    ['known_hosts_failed', 'writing known_hosts timed out'],
    ['authentication_failed', 'credentials rejected after connection reset'],
  ])('keeps %s structural even when the text names a transport symptom', (kind, text) => {
    const got = classifySshHostKeyGateFailure(tagged(kind, text), text)
    expect(got).not.toBe('unreachable')
  })

  it('every classified step has a headline string', () => {
    // A step with no key would render as the previous, wrong sentence.
    const steps = [
      'unreachable',
      'handshake',
      'jump-authentication',
      'known-hosts',
      'deadline',
      'input',
      'configuration',
    ] as const
    for (const step of steps) {
      expect(SSH_HOST_KEY_FAILURE_KEYS[step]).toMatch(/^terminal\./)
    }
    expect(Object.keys(SSH_HOST_KEY_FAILURE_KEYS).sort()).toEqual([...steps].sort())
  })
})

describe('humanising the preflight error text', () => {
  it('drops this repository’s own operation names and keeps the cause', () => {
    expect(
      humaniseSshHostKeyGateError(
        'connection failed: connect host-key probe failed: Connection refused (os error 61)',
      ),
    ).toBe('Connection refused (os error 61)')
  })

  it('drops the typed wrapper as well', () => {
    expect(
      humaniseSshHostKeyGateError('SSH host-key connection failed: Connection reset'),
    ).toBe('Connection reset')
  })

  it('leaves a message with no internal prefix alone', () => {
    expect(humaniseSshHostKeyGateError('Connection refused (os error 61)')).toBe(
      'Connection refused (os error 61)',
    )
  })

  /*
   * The failure mode worth guarding: a humaniser that strips its way to an empty
   * string leaves the user with a headline and nothing else. Falling back to the
   * original is ugly; showing nothing is a regression the old code did not have.
   */
  it('never returns an empty string', () => {
    // Trimming leaves nothing to strip, so this comes back as-is rather than blank.
    const result = humaniseSshHostKeyGateError('connection failed: ')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toBe('connection failed:')
  })
})
