import assert from 'node:assert/strict'
import test from 'node:test'
import { assessFault } from './fault-assessment.mjs'

const allPass = {
  FAULT_INJECTED: 'PASS',
  APPLICATION_FAILURE_OBSERVED: 'PASS',
  ORIGINAL_DATA_PRESERVED: 'PASS',
  NO_PARTIAL_MIGRATION: 'PASS',
  RECOVERY_SUCCEEDED: 'PASS',
}

test('a fault scenario passes only when every required fact passes', () => {
  assert.equal(assessFault('corrupt-db', allPass).overall, 'PASS')
  assert.equal(assessFault('read-only-data-dir', allPass).overall, 'PASS')
})

test('a missing application error observation is not a pass', () => {
  const result = assessFault('corrupt-db', {
    ...allPass,
    APPLICATION_FAILURE_OBSERVED: 'NOT_RUN',
  })
  assert.equal(result.overall, 'PARTIAL')
  assert.deepEqual(result.missing, ['APPLICATION_FAILURE_OBSERVED'])
})

test('a changed original database is a failure', () => {
  const result = assessFault('read-only-data-dir', {
    ...allPass,
    ORIGINAL_DATA_PRESERVED: 'FAIL',
  })
  assert.equal(result.overall, 'FAIL')
  assert.deepEqual(result.failed, ['ORIGINAL_DATA_PRESERVED'])
})

test('a partial migration or missing recovery is never a pass', () => {
  assert.equal(
    assessFault('restart-idempotent', {
      ...allPass,
      NO_PARTIAL_MIGRATION: 'FAIL',
    }).overall,
    'FAIL',
  )
  assert.equal(
    assessFault('read-only-data-dir', {
      ...allPass,
      RECOVERY_SUCCEEDED: 'NOT_RUN',
    }).overall,
    'PARTIAL',
  )
})

test('invalid or unknown inputs fail closed', () => {
  assert.throws(() => assessFault('not-a-fault', allPass), /unknown fault kind/)
  assert.throws(
    () => assessFault('corrupt-db', { ...allPass, RECOVERY_SUCCEEDED: 'OK' }),
    /invalid RECOVERY_SUCCEEDED/,
  )
})
