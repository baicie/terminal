/**
 * GitHub Actions conclusions, as a state machine.
 *
 * ## Why this is separate from the attribution categories
 *
 * The classifier answers "what kind of failure is this". That is a different question
 * from "did this run actually reach a verdict", and conflating them produced a bug
 * that reported a **timed-out run as clean**:
 *
 *   classifyRun({ conclusion: 'timed_out' })  ->  { category: null, detail: 'clean' }
 *
 * The old implementation only special-cased `cancelled` and then filtered jobs for
 * `conclusion === 'failure'`. Every other run conclusion fell through to "no job
 * failed", which reads as "nothing failed" — the single most dangerous sentence a CI
 * report can print.
 *
 * ## The rule
 *
 * A run reaches `pass` **only** when GitHub says `success`. Nothing else maps upward:
 * not `neutral`, not `skipped`, not a missing conclusion, and certainly not an unknown
 * string from a future API version.
 *
 * `superseded` is not a verdict at all — a cancelled or stale run says nothing about
 * the code. It is reported as its own state so nobody reads it as either green or red.
 */

/** Every conclusion the Runs and Jobs APIs can return, plus the in-progress `null`. */
export const KNOWN_RUN_CONCLUSIONS = new Set([
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'stale',
  'startup_failure',
])

/** Conclusions a single job can carry. Jobs do not report `stale`. */
export const KNOWN_JOB_CONCLUSIONS = new Set([
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
])

/**
 * What a run conclusion means.
 *
 * `verdict` is one of:
 *   pass         — the run finished and every job succeeded
 *   fail         — something did not succeed and no human verdict can clear it
 *   inconclusive — the run ended without a usable job-level result
 *   superseded   — the run was replaced or abandoned; not a statement about the code
 *   running      — no conclusion yet
 */
const RUN_TABLE = {
  success: { verdict: 'pass', reason: 'the run succeeded' },
  failure: { verdict: 'fail', reason: 'the run reported failure' },
  timed_out: {
    verdict: 'fail',
    reason: 'the run exceeded its time limit; a timeout is an unproven green, not a pass',
  },
  startup_failure: {
    verdict: 'fail',
    reason: 'the workflow could not start (its configuration is invalid)',
  },
  action_required: {
    verdict: 'fail',
    reason: 'the run is waiting for a human to approve it; it has not been evaluated',
  },
  cancelled: { verdict: 'superseded', reason: 'the run was cancelled' },
  stale: { verdict: 'superseded', reason: 'the run was superseded by a newer one' },
  skipped: { verdict: 'superseded', reason: 'the run was skipped by its conditions' },
  neutral: {
    verdict: 'inconclusive',
    reason: 'the run concluded neutral, which is neither a pass nor a failure',
  },
}

/**
 * Judge a whole run from its conclusion and its job count.
 *
 * `jobCount` is required because a `success` with no jobs is not a success: the
 * jobs endpoint always returns at least the run's own jobs, so an empty list means
 * the API answer was truncated or unreadable. Reporting that as a pass is how a
 * broken collector hides a real failure.
 */
export function judgeRun({ conclusion = null, jobCount = 0 } = {}) {
  if (conclusion === null || conclusion === undefined || conclusion === '') {
    return {
      verdict: 'running',
      reason: 'the run has no conclusion yet',
      terminal: false,
      requiresHuman: false,
    }
  }

  const row = RUN_TABLE[conclusion]
  if (row === undefined) {
    // An unrecognised conclusion is not permission to pass. A future API value, a
    // typo, or a proxied response all land here.
    return {
      verdict: 'inconclusive',
      reason: `unrecognised run conclusion ${JSON.stringify(conclusion)}; refusing to treat it as a pass`,
      terminal: true,
      requiresHuman: true,
      unknownConclusion: true,
    }
  }

  if (row.verdict === 'pass' && jobCount === 0) {
    return {
      verdict: 'inconclusive',
      reason:
        'the run reports success but returned no jobs, so the verdict cannot be ' +
        'confirmed from job results',
      terminal: true,
      requiresHuman: true,
    }
  }
  if (row.verdict === 'fail' && jobCount === 0) {
    return {
      verdict: 'inconclusive',
      reason:
        `the run reported ${conclusion} but returned no jobs, so there is nothing ` +
        'to attribute the failure to',
      terminal: true,
      requiresHuman: true,
    }
  }

  return {
    verdict: row.verdict,
    reason: row.reason,
    terminal: true,
    requiresHuman: row.verdict !== 'pass',
  }
}

/**
 * What one job's conclusion means.
 *
 * `state` is `ok`, `failed`, `skipped` or `inconclusive`. A cancelled job is `failed`
 * for gating purposes — it did not finish — but it is *not* a product defect, which is
 * a distinction the caller makes when it picks a category.
 */
export function judgeJob({ conclusion = null } = {}) {
  if (conclusion === null || conclusion === undefined || conclusion === '') {
    return { state: 'inconclusive', reason: 'no conclusion yet (still running)' }
  }
  if (conclusion === 'success') return { state: 'ok', reason: 'succeeded' }
  if (conclusion === 'failure') return { state: 'failed', reason: 'failed' }
  if (conclusion === 'timed_out') {
    return { state: 'failed', reason: 'timed out — an unproven result, not a pass' }
  }
  if (conclusion === 'cancelled') {
    return { state: 'failed', reason: 'cancelled before finishing' }
  }
  if (conclusion === 'action_required') {
    return { state: 'failed', reason: 'waiting for approval; never evaluated' }
  }
  if (conclusion === 'skipped') return { state: 'skipped', reason: 'skipped by its conditions' }
  if (conclusion === 'neutral') {
    return { state: 'inconclusive', reason: 'neutral: neither a pass nor a failure' }
  }
  return {
    state: 'inconclusive',
    reason: `unrecognised job conclusion ${JSON.stringify(conclusion)}`,
    unknownConclusion: true,
  }
}
