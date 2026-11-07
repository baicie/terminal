import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RESTORE_STAGES,
  assertStageOrder,
  crashPoint,
  restoreStagePlan,
} from './recovery-state-machine.mjs'

test('enforces the recovery stage order', () => {
  assert.equal(assertStageOrder(RESTORE_STAGES), true)
  assert.throws(() => assertStageOrder(['PREPARE', 'COMMIT', 'STAGE']), /order regression/)
  assert.throws(() => assertStageOrder(['PREPARE', 'UNKNOWN']), /unknown recovery stage/)
})

test('only injects a crash when the test flag is explicit', () => {
  assert.doesNotThrow(() => crashPoint('COMMIT', {}))
  assert.doesNotThrow(() => crashPoint('COMMIT', { TERMINAL_TEST_CRASH: '0', TERMINAL_RESTORE_CRASH_POINT: 'COMMIT' }))
  assert.throws(
    () => crashPoint('COMMIT', { TERMINAL_TEST_CRASH: '1', TERMINAL_RESTORE_CRASH_POINT: 'COMMIT' }),
    /injected recovery crash at COMMIT/,
  )
  assert.throws(() => crashPoint('NOPE', { TERMINAL_TEST_CRASH: '1' }), /unknown crash point/)
})

test('plans exactly one crash point', () => {
  const plan = restoreStagePlan('STAGE')
  assert.equal(plan.filter(step => step.crash).length, 1)
  assert.equal(plan.find(step => step.crash).stage, 'STAGE')
})
