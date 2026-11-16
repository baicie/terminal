// T20 — the Team Sync cross-version verdict, tested without starting PostgreSQL.
//
// The harness starts a real Nest app over real PostgreSQL and two client processes.
// The *meaning* of its output is in `team-cross-version-matrix.mjs`, which is pure and
// tested here.
//
// The rule that matters most: `TEAM_CROSS_VERSION_A_TO_B_VERIFIED` must be **FAIL** in a
// healthy run. It looks like a broken gate and is the opposite — a PASS would mean a
// released historical client can keep syncing, which the ADR deliberately forbids with
// `426 CLIENT_UPGRADE_REQUIRED`.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MUST_FAIL_IN_HEALTHY_RUN,
  MUST_PASS_IN_HEALTHY_RUN,
  computeMatrix,
  judgeMatrix,
} from './team-cross-version-matrix.mjs'

/** A run in which everything the harness drives succeeded and the policy refused. */
function healthyRun() {
  return {
    allOk: true,
    dirtyPathOk: true,
    verify: { ok: true, details: { legacyRejected: true, deletedSnippetId: null } },
  }
}

test('a healthy run refuses the historical client and records that refusal', () => {
  const matrix = computeMatrix(healthyRun())
  assert.equal(matrix.TEAM_CROSS_VERSION_A_TO_B_VERIFIED, 'FAIL')
  assert.equal(matrix.TEAM_LEGACY_CLIENT_SAFE_REJECTION, 'PASS')
  assert.equal(matrix.TEAM_MIN_SUPPORTED_CLIENT_POLICY, 'PASS')
  assert.equal(matrix.TEAM_CROSS_VERSION_DIRTY_ROW_UPGRADE, 'PASS')

  const verdict = judgeMatrix(matrix)
  assert.equal(verdict.healthy, true, JSON.stringify(verdict.problems))
})

test('a historical client that keeps syncing is the regression', () => {
  // This is the failure the matrix exists to catch, and the reason
  // `A_TO_B_VERIFIED` is not "fixed" to look green.
  const matrix = computeMatrix({
    allOk: true,
    dirtyPathOk: true,
    verify: { ok: true, details: { legacyRejected: false, deletedSnippetId: 'x' } },
  })
  assert.equal(matrix.TEAM_CROSS_VERSION_A_TO_B_VERIFIED, 'PASS', 'the old client synced')
  const verdict = judgeMatrix(matrix)
  assert.equal(verdict.healthy, false)
  assert.ok(verdict.problems.some(problem => problem.name === MUST_FAIL_IN_HEALTHY_RUN.name))
})

test('a rejected-but-crashed client is not a safe rejection', () => {
  // `legacyRejected` alone is not enough: the verify phase must have succeeded. A
  // rejection that came from a crash is not the documented 426.
  const matrix = computeMatrix({
    allOk: true,
    dirtyPathOk: true,
    verify: { ok: false, details: { legacyRejected: true } },
  })
  assert.equal(matrix.TEAM_LEGACY_CLIENT_SAFE_REJECTION, 'FAIL')
  assert.equal(matrix.TEAM_MIN_SUPPORTED_CLIENT_POLICY, 'FAIL')
  assert.equal(judgeMatrix(matrix).healthy, false)
})

test('a harness step failing shows up in the A-to-B entry', () => {
  // `allOk` covers whether the harness steps ran (server started, seed, upgrade,
  // dirty push). When one did not, the A-to-B entry is FAIL — but so is the entry a
  // healthy run also requires to be FAIL, so `judgeMatrix` alone cannot see it. That is
  // why the harness exits on `allOk` directly and this module judges the *policy*
  // contract. Documenting the split here prevents someone "simplifying" one into the
  // other and losing the distinction.
  const matrix = computeMatrix({ ...healthyRun(), allOk: false })
  assert.equal(matrix.TEAM_CROSS_VERSION_A_TO_B_VERIFIED, 'FAIL')
  // The policy entries are unaffected by a step failure when the verify phase ran.
  assert.equal(matrix.TEAM_LEGACY_CLIENT_SAFE_REJECTION, 'PASS')
  // And judgeMatrix judges the policy, so it is healthy: the harness's own exit code
  // is the signal for step failures.
  assert.equal(judgeMatrix(matrix).healthy, true)
})

test('a dirty-row push that did not clear is a failure', () => {
  const matrix = computeMatrix({ ...healthyRun(), dirtyPathOk: false })
  assert.equal(matrix.TEAM_CROSS_VERSION_DIRTY_ROW_UPGRADE, 'FAIL')
  assert.equal(judgeMatrix(matrix).healthy, false)
})

test('a tombstone that was consumed rather than resurrected is a failure', () => {
  // With no rejection, a deleted snippet must stay deleted.
  const matrix = computeMatrix({
    allOk: true,
    dirtyPathOk: true,
    verify: { ok: true, details: { legacyRejected: false, deletedSnippetId: null } },
  })
  assert.equal(matrix.TEAM_CROSS_VERSION_TOMBSTONE_CONSUMED, 'FAIL')
})

test('an absent verify result fails everything that depends on it', () => {
  const matrix = computeMatrix({ allOk: false, dirtyPathOk: false, verify: null })
  assert.equal(matrix.TEAM_LEGACY_CLIENT_SAFE_REJECTION, 'FAIL')
  assert.equal(matrix.TEAM_MIN_SUPPORTED_CLIENT_POLICY, 'FAIL')
  assert.equal(matrix.TEAM_CROSS_VERSION_A_TO_B_VERIFIED, 'FAIL')
  assert.equal(judgeMatrix(matrix).healthy, false)
})

test('the healthy-run contract names both directions', () => {
  // Guards the constants themselves: a future edit that adds A_TO_B_VERIFIED to
  // MUST_PASS would make every healthy run red, and this catches it.
  assert.ok(
    !MUST_PASS_IN_HEALTHY_RUN.includes(MUST_FAIL_IN_HEALTHY_RUN.name),
    `${MUST_FAIL_IN_HEALTHY_RUN.name} must not also be required to pass`,
  )
  assert.ok(MUST_FAIL_IN_HEALTHY_RUN.why.length > 20, 'the reason must be recorded')
})

test('judgeMatrix reports every problem, not just the first', () => {
  const matrix = computeMatrix({ allOk: false, dirtyPathOk: false, verify: null })
  const verdict = judgeMatrix(matrix)
  assert.ok(verdict.problems.length >= 4, JSON.stringify(verdict.problems))
})
