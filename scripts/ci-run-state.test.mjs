// T03 — every conclusion GitHub can return, and why `timed_out` must not be clean.
//
// Each case here failed on the previous implementation. The table is not illustrative:
// `classifyRun({ conclusion: 'timed_out' })` returned
// `{ category: null, detail: 'clean' }` and a report that printed "No job failed."
import assert from 'node:assert/strict'
import test from 'node:test'

import { judgeJob, judgeRun, KNOWN_JOB_CONCLUSIONS, KNOWN_RUN_CONCLUSIONS } from './ci-run-state.mjs'

test('only `success` is a pass', () => {
  assert.equal(judgeRun({ conclusion: 'success', jobCount: 3 }).verdict, 'pass')
  for (const conclusion of KNOWN_RUN_CONCLUSIONS) {
    if (conclusion === 'success') continue
    assert.notEqual(
      judgeRun({ conclusion, jobCount: 3 }).verdict,
      'pass',
      `${conclusion} must not read as a pass`,
    )
  }
})

test('a timed-out run is not clean', () => {
  // The defect: the previous classifier filtered jobs for `conclusion === 'failure'`,
  // found none, and reported `detail: 'clean'`. A timeout is an unproven green.
  const verdict = judgeRun({ conclusion: 'timed_out', jobCount: 2 })
  assert.equal(verdict.verdict, 'fail')
  assert.match(verdict.reason, /timeout|time limit/i)
  assert.equal(verdict.requiresHuman, true)
})

test('cancelled and stale are superseded, not verdicts about the code', () => {
  for (const conclusion of ['cancelled', 'stale']) {
    const verdict = judgeRun({ conclusion, jobCount: 4 })
    assert.equal(verdict.verdict, 'superseded', conclusion)
    assert.notEqual(verdict.verdict, 'pass')
    assert.notEqual(verdict.verdict, 'fail', 'a cancelled run did not evaluate the code')
  }
})

test('a future conclusion is never a pass', () => {
  // A value this code has not heard of is not permission.
  for (const conclusion of ['quantum_flux', 'SUCCESS', 'Failure', '']) {
    const verdict = judgeRun({ conclusion, jobCount: 1 })
    assert.notEqual(verdict.verdict, 'pass', JSON.stringify(conclusion))
  }
  assert.equal(judgeRun({ conclusion: 'quantum_flux', jobCount: 1 }).unknownConclusion, true)
})

test('success with no jobs is inconclusive, not a pass', () => {
  // The jobs endpoint always returns the run's jobs. An empty list means the answer
  // was truncated or unreadable, and "success" from a broken collector is not proof.
  const verdict = judgeRun({ conclusion: 'success', jobCount: 0 })
  assert.equal(verdict.verdict, 'inconclusive')
  assert.equal(verdict.requiresHuman, true)
})

test('failure with no jobs is inconclusive, and says why', () => {
  const verdict = judgeRun({ conclusion: 'failure', jobCount: 0 })
  assert.equal(verdict.verdict, 'inconclusive')
  assert.match(verdict.reason, /no jobs/i)
})

test('a run with no conclusion is still running', () => {
  for (const conclusion of [null, undefined, '']) {
    const verdict = judgeRun({ conclusion, jobCount: 1 })
    assert.equal(verdict.verdict, 'running')
    assert.equal(verdict.terminal, false)
    assert.equal(verdict.requiresHuman, false)
  }
})

test('neutral is inconclusive rather than a pass', () => {
  const verdict = judgeRun({ conclusion: 'neutral', jobCount: 2 })
  assert.equal(verdict.verdict, 'inconclusive')
  assert.notEqual(verdict.verdict, 'pass')
})

test('startup_failure and action_required fail', () => {
  for (const conclusion of ['startup_failure', 'action_required']) {
    assert.equal(judgeRun({ conclusion, jobCount: 2 }).verdict, 'fail', conclusion)
  }
})

test('every known run conclusion is in the table', () => {
  // A conclusion added here but missing from the table would silently become
  // `inconclusive`, which is safe but loses the specific reason.
  for (const conclusion of KNOWN_RUN_CONCLUSIONS) {
    const verdict = judgeRun({ conclusion, jobCount: 1 })
    assert.equal(verdict.unknownConclusion, undefined, `${conclusion} is not handled specifically`)
  }
})
