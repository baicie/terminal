import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertKnownScenario,
  compareFailureObservation,
  FAILURE_EXPECTATIONS,
  FAILURE_SCENARIOS,
} from './terminal-smoke-failure-scenarios.mjs'

test('every scenario listed has an expectation and vice versa', () => {
  assert.deepEqual(
    Object.keys(FAILURE_EXPECTATIONS).sort(),
    [...FAILURE_SCENARIOS].sort(),
  )
})

test('rejects an unknown scenario name before anything starts', () => {
  assert.doesNotThrow(() => assertKnownScenario('BASTION_AUTH_REJECTED'))
  assert.throws(() => assertKnownScenario('TARGET_EXPLODED'), /unknown failure scenario/)
  assert.throws(() => assertKnownScenario(undefined), /unknown failure scenario/)
})

test('separates terminal refusals from transient faults', () => {
  /*
   * The distinction the product spends real budget on: a credential refusal must not be
   * retried, an unreachable host must be. If this table ever says otherwise, the smoke run
   * is measuring a product that retries a refused password five times.
   */
  const terminal = [
    'BASTION_AUTH_REJECTED',
    'TARGET_AUTH_REJECTED',
    'BASTION_HOST_KEY_REJECTED',
    'TARGET_HOST_KEY_REJECTED',
  ]
  const transient = ['DIRECT_UNREACHABLE', 'TUNNEL_OPEN_FAILED']
  for (const scenario of terminal) {
    assert.equal(FAILURE_EXPECTATIONS[scenario].retryable, false, scenario)
  }
  for (const scenario of transient) {
    assert.equal(FAILURE_EXPECTATIONS[scenario].retryable, true, scenario)
  }
})

test('a direct scenario claims no hop; the tunnel case claims the bastion but no machine in its diagnosis', () => {
  assert.equal(FAILURE_EXPECTATIONS.DIRECT_UNREACHABLE.hop, undefined)
  assert.equal(FAILURE_EXPECTATIONS.DIRECT_UNREACHABLE.diagnosis, undefined)
  /*
   * Corrected after a real run. `hop` is the connection holding the channel, so the bastion
   * is the honest answer; `diagnosis` is the user-facing sentence, and it deliberately
   * names no machine because the API cannot tell a refused forward from an unreachable
   * target. The two fields answer different questions and must not be conflated — the
   * first version of this test asserted `hop: undefined` and failed a correct product.
   */
  assert.equal(FAILURE_EXPECTATIONS.TUNNEL_OPEN_FAILED.hop, 'bastion')
  assert.equal(FAILURE_EXPECTATIONS.TUNNEL_OPEN_FAILED.diagnosis, 'tunnel-failed')
  assert.equal(FAILURE_EXPECTATIONS.TUNNEL_OPEN_FAILED.stage, 'tunnel_open')
  for (const scenario of [
    'BASTION_AUTH_REJECTED',
    'TARGET_AUTH_REJECTED',
    'BASTION_HOST_KEY_REJECTED',
    'TARGET_HOST_KEY_REJECTED',
  ]) {
    assert.ok(FAILURE_EXPECTATIONS[scenario].hop, scenario)
    assert.ok(FAILURE_EXPECTATIONS[scenario].diagnosis, scenario)
  }
})

test('accepts a matching observation', () => {
  assert.deepEqual(
    compareFailureObservation('BASTION_AUTH_REJECTED', {
      hop: 'bastion',
      stage: 'authentication',
      diagnosis: 'bastion-auth-rejected',
    }),
    [],
  )
  assert.deepEqual(compareFailureObservation('DIRECT_UNREACHABLE', {}), [])
})

test('reports a wrong hop as the machine-naming defect it is', () => {
  const problems = compareFailureObservation('TARGET_AUTH_REJECTED', {
    hop: 'bastion',
    stage: 'authentication',
    diagnosis: 'bastion-auth-rejected',
  })
  assert.equal(problems.length, 2)
  assert.match(problems[0], /expected hop "target"/)
  assert.match(problems[1], /expected diagnosis "target-auth-rejected"/)
})

test('treats an inherited hop on a direct failure as a problem', () => {
  /*
   * The exact shape F06 fixed in the ladder: a later failure must not carry an earlier
   * attempt's context. A direct failure reporting a hop is that defect reaching the pane.
   */
  const problems = compareFailureObservation('DIRECT_UNREACHABLE', { hop: 'bastion' })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /expected hop null/)
})

test('does not compare attempt counts to the configured maximum', () => {
  /*
   * SSH19: `attempts` is only reported when the terminal actually counted. A table that
   * expected a number would push the harness toward filling in `maxAttempts`, which is the
   * "expected configuration written into a measured field" failure the contract forbids.
   */
  const base = {
    hop: 'bastion',
    stage: 'authentication',
    diagnosis: 'bastion-auth-rejected',
  }
  assert.deepEqual(compareFailureObservation('BASTION_AUTH_REJECTED', { ...base, attempts: 7 }), [])
  assert.deepEqual(
    compareFailureObservation('BASTION_AUTH_REJECTED', { ...base, attempts: null }),
    [],
  )
})

test('BASTION_UNREACHABLE names no machine, because no machine was reached', () => {
  /*
   * The bastion's listener is gone before any host key is exchanged. Reporting
   * `hop: 'bastion'` would be a claim about a machine the product never talked to —
   * the same defect F06 fixed in the ladder, one layer up.
   */
  const expected = FAILURE_EXPECTATIONS.BASTION_UNREACHABLE
  assert.equal(expected.hop, undefined)
  assert.equal(expected.diagnosis, undefined)
  assert.equal(expected.retryable, true)
  assert.deepEqual(compareFailureObservation('BASTION_UNREACHABLE', {}), [])
  assert.equal(
    compareFailureObservation('BASTION_UNREACHABLE', { hop: 'bastion' }).length,
    1,
  )
})
