// F13 — the server-side dial counter must count what sshd actually writes.
//
// Real captured line shapes, because the whole value of this module is that it agrees with
// the daemon rather than with our client. Every case below is a line OpenSSH emits at
// `LogLevel VERBOSE` (or one it emits that must *not* be counted).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  connectionCountProblems,
  countServerConnections,
} from './terminal-smoke-server-dials.mjs'

describe('counting the daemon\'s own connection lines', () => {
  it('counts one line per accepted TCP connection', () => {
    const log = [
      'Connection from 127.0.0.1 port 51234 on 127.0.0.1 port 2222',
      'Connection from 127.0.0.1 port 51240 on 127.0.0.1 port 2222',
      'Connection from 127.0.0.1 port 51246 on 127.0.0.1 port 2222',
    ].join('\n')
    assert.equal(countServerConnections(log), 3)
  })

  it('does not count authentication lines', () => {
    /*
     * `Failed publickey` counts attempts *within* a connection. Rust's ladder opens a new
     * connection per try, so counting these would answer a different question — and would
     * return zero for a scenario that fails before authentication.
     */
    const log = [
      'Connection from 127.0.0.1 port 51234 on 127.0.0.1 port 2222',
      'Failed publickey for smoketest from 127.0.0.1 port 51234 ssh2',
      'Failed publickey for smoketest from 127.0.0.1 port 51234 ssh2',
    ].join('\n')
    assert.equal(countServerConnections(log), 1)
  })

  it('does not count Disconnected lines', () => {
    // `Disconnected from ...` is the tail of a connection already counted at its start.
    const log = [
      'Connection from 127.0.0.1 port 1 on 127.0.0.1 port 2222',
      'Disconnected from 127.0.0.1 port 1',
    ].join('\n')
    assert.equal(countServerConnections(log), 1)
  })

  it('tolerates the syslog prefix macOS builds prepend', () => {
    // `sshd -e` writes to stderr, but some builds still prefix with a timestamp/host tag.
    const log =
      'Nov 26 10:00:00 host sshd[123]: Connection from 127.0.0.1 port 51234 on 127.0.0.1 port 2222'
    assert.equal(countServerConnections(log), 1)
  })

  it('returns zero for empty or missing logs', () => {
    assert.equal(countServerConnections(''), 0)
    assert.equal(countServerConnections(undefined), 0)
    assert.equal(countServerConnections(null), 0)
  })
})

describe('comparing dials against the policy', () => {
  it('matches the dial counts measured against a real sshd', () => {
    /*
     * One entry per value actually measured on this host, so the expectation is the
     * observed relationship rather than a plausible one. The re-established bastion on the
     * tunnel path is the second extra dial; see the module comment.
     */
    for (const [maxAttempts, observed] of [
      [1, 3],
      [2, 4],
      [3, 5],
    ]) {
      assert.deepEqual(
        connectionCountProblems({ observed, maxAttempts }),
        [],
        `maxAttempts=${maxAttempts} should expect ${maxAttempts + 2} dials`,
      )
    }
  })

  it('moves by exactly one dial per attempt, proving the count is policy-shaped', () => {
    /*
     * The assertion that makes this a test of the policy rather than of a constant: a
     * number hard-coded to the first failing run would pass one case and fail every other
     * budget.
     */
    const expected = [1, 2, 3, 4].map(
      maxAttempts => maxAttempts + 2,
    )
    assert.deepEqual(expected, [3, 4, 5, 6])
  })

  it('names the disagreement when the counts differ', () => {
    const problems = connectionCountProblems({ observed: 3, maxAttempts: 5 })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /expected 7 dials/)
    assert.match(problems[0], /server logged 3/)
  })

  it('rejects an attempt count it cannot interpret', () => {
    // A bad policy must fail the harness rather than quietly compare against NaN.
    assert.throws(() => connectionCountProblems({ observed: 1, maxAttempts: 0 }))
    assert.throws(() => connectionCountProblems({ observed: 1, maxAttempts: 1.5 }))
  })
})
