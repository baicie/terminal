/**
 * The Team Sync cross-version verdict, as a pure function.
 *
 * ## Why this is separate from the harness
 *
 * The harness starts a real PostgreSQL, a real Nest app and two client processes; it
 * cannot be imported by a test without doing all of that. The verdict rules are where
 * the meaning lives, so they are extracted here and tested directly.
 *
 * ## The thing that looks wrong and is not
 *
 * `TEAM_CROSS_VERSION_A_TO_B_VERIFIED` is **designed** to be `FAIL`. A `PASS` would mean
 * a released client can keep syncing; the ADR (`docs/phase9-7/adr-legacy-sync-policy.md`)
 * deliberately stops it with `426 CLIENT_UPGRADE_REQUIRED` for a millisecond cursor,
 * before any read.
 *
 * What is asserted instead is the *contract* of that refusal:
 *
 *   SAFE_REJECTION          the old client was rejected, and the rejection was the
 *                           documented one rather than a crash or a silent wrong answer
 *   MIN_SUPPORTED_CLIENT_POLICY  the same thing, stated as policy
 *
 * So the pairs are `FAIL + PASS + PASS` for a healthy run, and that combination is what
 * the tests below pin. A run where the old client *keeps syncing* is the regression, and
 * it flips `A_TO_B_VERIFIED` to `PASS` — which is exactly why the value is load-bearing
 * and must not be "fixed" to look greener.
 */

/** Verdicts for one cross-version run. */
export function computeMatrix({ allOk, dirtyPathOk, verify }) {
  const legacyRejected = verify?.details?.legacyRejected === true
  const verifyOk = verify?.ok === true
  const deletedSnippetId = verify?.details?.deletedSnippetId ?? null

  return {
    TEAM_CROSS_VERSION_A_TO_B_VERIFIED:
      allOk && !legacyRejected ? 'PASS' : 'FAIL',
    TEAM_CROSS_VERSION_DIRTY_ROW_UPGRADE: dirtyPathOk ? 'PASS' : 'FAIL',
    TEAM_LEGACY_CLIENT_SAFE_REJECTION: verifyOk && legacyRejected ? 'PASS' : 'FAIL',
    TEAM_MIN_SUPPORTED_CLIENT_POLICY: verifyOk && legacyRejected ? 'PASS' : 'FAIL',
    TEAM_CROSS_VERSION_TOMBSTONE_CONSUMED:
      verifyOk && !legacyRejected && deletedSnippetId !== null ? 'PASS' : 'FAIL',
    TEAM_CROSS_VERSION_TOMBSTONE_RESURRECTION: verifyOk ? 'PASS' : 'FAIL',
  }
}

/**
 * Which matrix entries must be `PASS` for a healthy run.
 *
 * `A_TO_B_VERIFIED` is deliberately absent: it must be `FAIL`, and a test asserts that
 * separately so a future reader cannot "fix" it.
 */
export const MUST_PASS_IN_HEALTHY_RUN = [
  'TEAM_CROSS_VERSION_DIRTY_ROW_UPGRADE',
  'TEAM_LEGACY_CLIENT_SAFE_REJECTION',
  'TEAM_MIN_SUPPORTED_CLIENT_POLICY',
  'TEAM_CROSS_VERSION_TOMBSTONE_RESURRECTION',
]

/** The one entry that must NOT pass in a healthy run, and why. */
export const MUST_FAIL_IN_HEALTHY_RUN = {
  name: 'TEAM_CROSS_VERSION_A_TO_B_VERIFIED',
  why:
    'a PASS would mean the released historical client can keep syncing; the min-version ' +
    'policy deliberately refuses it with 426 CLIENT_UPGRADE_REQUIRED',
}

/**
 * Judge a completed run's matrix.
 *
 * Returns `{healthy, problems}`. This is *not* the process exit code: the harness exits
 * on whether its steps ran. Keeping the two separate is the point — a policy `FAIL` is
 * not a harness failure.
 */
export function judgeMatrix(matrix) {
  const problems = []
  for (const name of MUST_PASS_IN_HEALTHY_RUN) {
    if (matrix[name] !== 'PASS') {
      problems.push({ name, expected: 'PASS', actual: matrix[name] ?? '<missing>' })
    }
  }
  const forbidden = MUST_FAIL_IN_HEALTHY_RUN.name
  if (matrix[forbidden] !== 'FAIL') {
    problems.push({
      name: forbidden,
      expected: 'FAIL',
      actual: matrix[forbidden] ?? '<missing>',
      why: MUST_FAIL_IN_HEALTHY_RUN.why,
    })
  }
  return { healthy: problems.length === 0, problems }
}
