/**
 * Classify a CI failure so the report says what to do about it.
 *
 * ## Why a classifier instead of a long log
 *
 * The failure history in this repository is dominated by one category that is not a
 * code problem: `Repository gates` failing because the acceptance evidence describes
 * an older checkout. Before the evidence split (#83) that single cause was
 * indistinguishable from a real regression without opening the log and reading it —
 * and "the CI is red" is not an actionable sentence.
 *
 * The categories come from the task, not from the data: the sample here is too small
 * to derive them, and a classifier fitted to three examples would break on the fourth.
 *
 * ## The rule that matters most
 *
 * `UNKNOWN` exists and is the default. A failure nobody classified must not be filed
 * under `KNOWN_ISSUE` — that is how a new regression gets absorbed into the baseline
 * and stops being visible.
 *
 * ## Three separate questions, three separate fields
 *
 * The first version had one `blocking` boolean, and a summary reading
 * `Blocking: no` was taken to mean "this PR will merge". It does not: a required check
 * that failed blocks the merge whatever a report says about it. The report now states
 * four facts that are deliberately not derived from one another:
 *
 *   classification       what kind of failure this is
 *   humanAction          what a person should do about it
 *   requiredCheckResult  did a check GitHub gates merges on fail (never softened)
 *   mergeEligibility     is this commit mergeable, given the above and the gate result
 */
import { judgeJob, judgeRun } from './ci-run-state.mjs'
import { isKnownIssue, parseKnownIssueReference } from './ci-known-issue.mjs'

/** Every category, and what a human must do about it. */
export const FAILURE_CATEGORIES = {
  PRODUCT_REGRESSION: { action: 'fix the product', blocking: true },
  TEST_REGRESSION: { action: 'fix the test or the behaviour it pins', blocking: true },
  INFRA_FAILURE: { action: 're-run; no code change needed', blocking: false },
  SECURITY_FINDING: { action: 'triage the advisory', blocking: true },
  EVIDENCE_STALE: { action: 're-run real-machine-matrix on this commit', blocking: false },
  RELEASE_BLOCKED: { action: 'a release gate refused; read its message', blocking: true },
  KNOWN_ISSUE: { action: 'tracked; see docs/issue.md', blocking: false },
  UNKNOWN: { action: 'a human must look at this', blocking: true },
}

/**
 * Signatures, most specific first.
 *
 * Each entry is matched against the failing step's log text. Order matters: the
 * evidence message also contains the word "fingerprint", and a real product failure
 * must not be shadowed by a less specific entry.
 */
const SIGNATURES = [
  {
    category: 'EVIDENCE_STALE',
    // The exact sentences the gate prints. Anchored on the wording rather than the
    // word "fingerprint" so a fingerprint *bug* is not filed as stale evidence.
    //
    // Both forms are needed and they come from different checks: the manifest says
    // "was produced from source fingerprint", each evidence file says "was recorded
    // against source fingerprint". Measured on a real log: matching only the second
    // left the first classified as UNKNOWN.
    test: /was recorded against source fingerprint|was produced from source fingerprint|does not describe this commit/i,
  },
  {
    category: 'RELEASE_BLOCKED',
    test: /release qualification: FAIL|\[check-(missing|wrong-sha|not-success|incomplete|unreadable)\]/i,
  },
  {
    category: 'SECURITY_FINDING',
    test: /RUSTSEC-|new advisory|advisory not in the baseline|npm audit.*vulnerabilit/i,
  },
  {
    category: 'INFRA_FAILURE',
    // Network and registry trouble seen in this repository's own history:
    // `SSL_ERROR_SYSCALL` on crates.io, `tauri-apps/binary-releases` 502/504.
    test: /ECONNRESET|ECONNREFUSED|SSL_ERROR_SYSCALL|ETIMEDOUT|502 Bad Gateway|504 Gateway|rate limit|temporary failure in name resolution|Could not resolve host|no space left on device/i,
  },
  {
    category: 'TEST_REGRESSION',
    test: /test result: FAILED|AssertionError|assertion .* failed|expected .* to (be|equal|contain)|✖ /i,
  },
  {
    category: 'PRODUCT_REGRESSION',
    // A compiler or linter error is the product failing to build, which is more
    // specific than "a test failed" and must not be hidden by the test pattern.
    //
    // The `m` flag is load-bearing: without it `^error` only matches at the very
    // start of a string, and the haystack always begins with the job name, so the
    // first alternative could never fire. Measured: a real log line
    // `error: could not compile \`terminal\` (lib test) due to 2 previous errors`
    // classified as UNKNOWN until the flag was added.
    test: /^error(\[E\d+\])?:|error\[E\d+\]|panicked at/im,
  },
]

/**
 * Classify one failing job.
 *
 * `informational` is passed through rather than folded into the category: an
 * informational job failing is a different fact from a blocking one, and the report
 * has to say which it was.
 *
 * `knownIssueSources` carries the documentation the reference validator needs
 * (`knownIssueNumbers`, `knownAnchors`, `agentsLineCount`, `repo`). Omitting it makes
 * every `KNOWN_ISSUE` claim unverifiable, which resolves to `UNKNOWN` — the safe
 * direction.
 */
export function classifyFailure({
  jobName,
  logText = '',
  informational = false,
  knownIssueSources = {},
  logStatus = null,
}) {
  const haystack = `${jobName}\n${logText}`
  for (const signature of SIGNATURES) {
    if (signature.test.test(haystack)) {
      const meta = FAILURE_CATEGORIES[signature.category]
      return {
        category: signature.category,
        action: meta.action,
        blocking: informational ? false : meta.blocking,
        informational,
        matched: signature.test.source.slice(0, 60),
        logStatus,
      }
    }
  }

  // Last, and only on a resolved reference. A bare "known issue" is not a category.
  const known = isKnownIssue(haystack, { ...knownIssueSources })
  if (known.known) {
    const meta = FAILURE_CATEGORIES.KNOWN_ISSUE
    return {
      category: 'KNOWN_ISSUE',
      action: meta.action,
      blocking: informational ? false : meta.blocking,
      informational,
      matched: `known-issue reference: ${known.reference.raw}`,
      knownIssueReason: known.reason,
      logStatus,
    }
  }

  return {
    category: 'UNKNOWN',
    action: FAILURE_CATEGORIES.UNKNOWN.action,
    blocking: informational ? false : true,
    informational,
    matched: null,
    // Why an UNKNOWN is UNKNOWN is itself worth reporting: "no signature matched" and
    // "the log could not be read" are different problems for the person fixing it.
    logStatus,
    knownIssueReason: parseKnownIssueReference(haystack) ? known.reason : null,
  }
}

/**
 * Turn job entries into the failures worth reporting.
 *
 * A job counts as a failure when its state is `failed`. `timed_out` is a failure
 * (an unproven result is not a pass), `cancelled` is a failure for gating but not a
 * product verdict, and `inconclusive` is reported as such rather than dropped.
 */
function collectJobFailures(jobs, knownIssueSources) {
  const failures = []
  const notEvaluated = []
  for (const job of jobs) {
    const judged = judgeJob({ conclusion: job.conclusion })
    if (judged.state === 'ok' || judged.state === 'skipped') continue
    if (judged.state === 'inconclusive') {
      notEvaluated.push({
        job: job.name,
        conclusion: job.conclusion ?? null,
        reason: judged.reason,
      })
      continue
    }
    const classified = classifyFailure({
      jobName: job.name,
      logText: job.logText ?? '',
      informational: job.informational === true,
      knownIssueSources,
      logStatus: job.logStatus ?? null,
    })
    failures.push(Object.assign({ job: job.name, conclusion: job.conclusion ?? null }, classified))
  }
  return { failures, notEvaluated }
}

/**
 * Classify a whole run.
 *
 * The run's own conclusion is the primary input, judged by `ci-run-state.mjs`. The
 * job list refines it; it never overrides it upward. A `timed_out` run with no failing
 * job is still not clean, and a run with no conclusion is still running.
 */
export function classifyRun({
  jobs = [],
  conclusion = null,
  knownIssueSources = {},
  requiredCheckFailed = null,
} = {}) {
  const run = judgeRun({ conclusion, jobCount: jobs.length })
  const { failures, notEvaluated } = collectJobFailures(jobs, knownIssueSources)

  // "Nothing failed" is only sayable when the run actually passed. Every other
  // terminal state gets its own answer, because silence here was the defect.
  if (run.verdict === 'superseded') {
    return {
      category: 'INFRA_FAILURE',
      action: 'the run was superseded; re-run if its verdict is still needed',
      blocking: false,
      detail: run.reason,
      runVerdict: run.verdict,
      jobs: failures,
      notEvaluated,
      requiredCheckFailed,
      mergeEligibility: 'not-evaluated',
    }
  }

  if (run.verdict === 'running') {
    return {
      category: null,
      action: 'the run has not finished; there is nothing to attribute yet',
      blocking: false,
      detail: 'running',
      runVerdict: run.verdict,
      jobs: [],
      notEvaluated,
      requiredCheckFailed,
      mergeEligibility: 'pending',
    }
  }

  if (run.verdict === 'inconclusive') {
    return {
      category: 'UNKNOWN',
      action: FAILURE_CATEGORIES.UNKNOWN.action,
      blocking: true,
      detail: run.reason,
      runVerdict: run.verdict,
      jobs: failures,
      notEvaluated,
      requiredCheckFailed,
      mergeEligibility: 'blocked',
      runInconclusive: true,
    }
  }

  if (run.verdict === 'pass') {
    if (failures.length > 0) {
      // The run says success but a job says otherwise. Trust the job: the report
      // must not print "nothing failed" over a failing job.
      return {
        category: 'UNKNOWN',
        action: FAILURE_CATEGORIES.UNKNOWN.action,
        blocking: true,
        detail: `the run reports success but ${failures.length} job(s) did not`,
        runVerdict: 'inconsistent',
        jobs: failures,
        notEvaluated,
        requiredCheckFailed,
        mergeEligibility: requiredCheckFailed === true ? 'blocked' : 'not-evaluated',
      }
    }
    return {
      category: null,
      action: 'nothing failed',
      blocking: false,
      detail: 'clean',
      runVerdict: run.verdict,
      jobs: [],
      notEvaluated,
      requiredCheckFailed,
      mergeEligibility: requiredCheckFailed === true ? 'blocked' : 'eligible',
    }
  }

  // run.verdict === 'fail'
  if (failures.length === 0 && notEvaluated.length === 0) {
    // A failing run whose jobs are all green means the failure lives somewhere the
    // job list does not show — a required-check aggregator, or a collector that came
    // back empty. That is not "nothing failed".
    return {
      category: 'UNKNOWN',
      action: FAILURE_CATEGORIES.UNKNOWN.action,
      blocking: true,
      detail:
        'the run failed but no failing job was reported; the job list is incomplete ' +
        'and the failure cannot be attributed',
      runVerdict: run.verdict,
      jobs: [],
      notEvaluated,
      requiredCheckFailed,
      mergeEligibility: 'blocked',
      runInconclusive: true,
    }
  }

  // ## A non-success job with no category is not a "failure" entry
  //
  // `notEvaluated` holds jobs whose conclusion is `neutral` or unrecognised — real
  // cases, because `continue-on-error: true` jobs report `neutral` on failure (e.g.
  // `zsh probe diagnostic`). An earlier version built the chosen entry from
  // `notEvaluated` and then read `chosen.category`, which is not a field those entries
  // have:
  //
  //   classifyRun({ conclusion: 'failure', jobs: [
  //     { name: 'zsh probe diagnostic', conclusion: 'neutral' },
  //   ]})  ->  TypeError: Cannot read properties of undefined (reading 'category')
  //
  // The step is `continue-on-error: true`, so the crash was silent — the exact
  // "looks like it ran, told you nothing" shape this module exists to remove.
  if (failures.length === 0) {
    return {
      category: 'UNKNOWN',
      action: FAILURE_CATEGORIES.UNKNOWN.action,
      blocking: true,
      detail:
        `the run does not show a clean verdict and ${notEvaluated.length} job(s) had no ` +
        'usable conclusion, so there is nothing to attribute',
      runVerdict: run.verdict,
      // Reported in the `notEvaluated` table, not as classified failures: an entry
      // here has no category and must not be presented as one.
      jobs: [],
      notEvaluated,
      requiredCheckFailed,
      mergeEligibility:
        requiredCheckFailed === true ? 'blocked' : requiredCheckFailed === false ? 'eligible' : 'not-evaluated',
    }
  }

  const blocking = failures.filter(failure => failure.blocking)
  const chosen = (blocking.length > 0 ? blocking : failures)[0]

  return {
    category: chosen.category,
    action: chosen.action,
    blocking: blocking.length > 0,
    detail: `${failures.length} non-success job(s), ${blocking.length} blocking`,
    runVerdict: run.verdict,
    // Merge eligibility is decided by the required check, never by this classifier.
    // "Blocking: no" is a statement about the code's cause, not about the gate.
    jobs: failures,
    notEvaluated,
    requiredCheckFailed,
    mergeEligibility:
      requiredCheckFailed === true ? 'blocked' : requiredCheckFailed === false ? 'eligible' : 'not-evaluated',
  }
}
