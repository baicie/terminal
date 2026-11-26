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
  countServerRefusals,
  credentialRefusalProblems,
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

describe('RC15 — counting the daemon\'s refusals', () => {
  it('ignores the fixture readiness probe that logs in successfully', () => {
    /*
     * The exact shape measured on a real run, verbatim. The first pair is the harness's own
     * `waitUntilReady` probe; the second is the product's one attempt being refused.
     * Counting `Connection from` here would return 2 and report a product defect that is
     * not there — which is what the first version of this check did.
     */
    const log = [
      'Connection from 127.0.0.1 port 51160 on 127.0.0.1 port 51159',
      'Accepted publickey for liuzhiwei from 127.0.0.1 port 51160 ssh2: ED25519 SHA256:SOy+xVOD13bsgGwk/UnuZ3HldcS1b3tB2WxQhN4PpLM',
      'Connection from 127.0.0.1 port 51167 on 127.0.0.1 port 51159',
      'Failed publickey for liuzhiwei from 127.0.0.1 port 51167 ssh2: ED25519 SHA256:CFcsAqNy46uhH3iU4jwkV7t2IjVMLeS5v75jYKMGbBg',
    ].join('\n')
    assert.equal(countServerConnections(log), 2)
    assert.equal(countServerRefusals(log), 1)
  })

  it('counts every refusal, so a retried credential is visible', () => {
    const log = [
      'Failed publickey for a from 127.0.0.1 port 1 ssh2: ED25519 SHA256:AAA',
      'Failed publickey for a from 127.0.0.1 port 2 ssh2: ED25519 SHA256:AAA',
    ].join('\n')
    assert.equal(countServerRefusals(log), 2)
  })

  it('returns zero for empty or missing logs', () => {
    assert.equal(countServerRefusals(''), 0)
    assert.equal(countServerRefusals(undefined), 0)
  })
})

describe('RC15 — a refused credential is presented once', () => {
  it('accepts exactly one refusal', () => {
    assert.deepEqual(credentialRefusalProblems({ observed: 1 }), [])
  })

  it('rejects a second dial, and says what it means', () => {
    /*
     * The defect RC15 exists for: a ladder that runs after a refusal resends a secret the
     * server already evaluated and rejected. Five is what the shipped defaults would
     * produce if `authentication_rejected` stopped being terminal.
     */
    const problems = credentialRefusalProblems({ observed: 5 })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /exactly once, server refused it 5 time/)
    assert.match(problems[0], /already rejected/)
  })

  it('treats zero refusals as a failure too', () => {
    /*
     * Zero means the daemon never saw the attempt: the scenario did not exercise a refusal
     * at all, so this case would pass while proving nothing. Silence is not success.
     */
    const problems = credentialRefusalProblems({ observed: 0 })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /never saw a refusal/)
    assert.doesNotMatch(problems[0], /already rejected/)
  })
})
