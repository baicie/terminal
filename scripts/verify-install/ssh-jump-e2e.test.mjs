import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCaseNames } from './ssh-jump-e2e.mjs'

test('parses the module path libtest actually prints', () => {
  /*
   * Regression: the first version matched `^test ssh_jump_e2e_tests::`, but libtest
   * prints the full module path. `report.cases` was `[]` on every run — including a
   * PASS — so the report could not show which cases had run. Measured on a real PASS
   * before the fix.
   */
  const stdout = [
    'running 8 tests',
    'test session::ssh::ssh_jump_e2e_tests::a_real_two_hop_connection_authenticates_both_legs ... ok',
    'test session::ssh::ssh_jump_e2e_tests::a_bastion_refusal_is_attributed_to_the_bastion ... ok',
    'test session::ssh::ssh_jump_e2e_tests::something_else ... FAILED',
    'test result: FAILED. 2 passed; 1 failed',
  ].join('\n')

  assert.deepEqual(parseCaseNames(stdout), [
    {
      name: 'session::ssh::ssh_jump_e2e_tests::a_real_two_hop_connection_authenticates_both_legs',
      outcome: 'ok',
    },
    {
      name: 'session::ssh::ssh_jump_e2e_tests::a_bastion_refusal_is_attributed_to_the_bastion',
      outcome: 'ok',
    },
    {
      name: 'session::ssh::ssh_jump_e2e_tests::something_else',
      outcome: 'FAILED',
    },
  ])
})

test('the failing shape: a bare-name regex matches nothing', () => {
  // The negative control. If this ever starts matching, the test above stopped testing.
  const stdout =
    'test session::ssh::ssh_jump_e2e_tests::x ... ok\n'
  const old = stdout
    .split('\n')
    .map(line => /^test (ssh_jump_e2e_tests::\S+) \.\.\. (ok|FAILED)/.exec(line.trim()))
    .filter(Boolean)
  assert.deepEqual(old, [])
})

test('ignores lines that are not case results', () => {
  assert.deepEqual(parseCaseNames('running 0 tests\n\ntest result: ok. 0 passed'), [])
})
