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
 */

/** Every category, and whether a human must act. */
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
 * evidence message also contains the word "fingerprint", and the known-issue entry
 * must not shadow a real product failure.
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
    category: 'KNOWN_ISSUE',
    // Must name an issue or a documented defect, never a bare "known".
    test: /known issue|docs\/issue\.md#|AGENTS\.md:\d+|see issue #\d+/i,
  },
  {
    category: 'TEST_REGRESSION',
    test: /test result: FAILED|AssertionError|assertion .* failed|expected .* to (be|equal|contain)|✖ /i,
  },
  {
    category: 'PRODUCT_REGRESSION',
    // A compiler or linter error is the product failing to build, which is more
    // specific than "a test failed" and must not be hidden by the test pattern.
    test: /^error(\[E\d+\])?:|error\[E\d+\]|panicked at/i,
  },
]

/**
 * Classify one failing job.
 *
 * `informational` is passed through rather than folded into the category: an
 * informational job failing is a different fact from a blocking one, and the report
 * has to say which it was.
 */
export function classifyFailure({ jobName, logText = '', informational = false }) {
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
      }
    }
  }
  return {
    category: 'UNKNOWN',
    action: FAILURE_CATEGORIES.UNKNOWN.action,
    blocking: informational ? false : true,
    informational,
    matched: null,
  }
}

/**
 * Classify a whole run.
 *
 * `conclusion` is checked first: a run that was cancelled or never finished is not a
 * product verdict, and reporting it as one sends someone reading code for nothing.
 */
export function classifyRun({ jobs = [], conclusion = null } = {}) {
  if (conclusion === 'cancelled') {
    return {
      category: 'INFRA_FAILURE',
      action: 'the run was cancelled; re-run if its verdict is still needed',
      blocking: false,
      detail: 'cancelled',
      jobs: [],
    }
  }

  const failures = jobs
    .filter(job => job.conclusion === 'failure')
    .map(job =>
      Object.assign(
        { job: job.name },
        classifyFailure({
          jobName: job.name,
          logText: job.logText ?? '',
          informational: job.informational === true,
        }),
      ),
    )

  if (failures.length === 0) {
    return { category: null, action: 'nothing failed', blocking: false, detail: 'clean', jobs: [] }
  }

  // The most blocking failure wins: a run with one product regression and two
  // infrastructure flakes is a product regression.
  const blocking = failures.filter(failure => failure.blocking)
  const chosen = (blocking.length > 0 ? blocking : failures)[0]
  return {
    category: chosen.category,
    action: chosen.action,
    blocking: blocking.length > 0,
    detail: `${failures.length} failing job(s), ${blocking.length} blocking`,
    jobs: failures,
  }
}

/** Render the report a reader sees in a job summary. */
export function renderReport(result) {
  const lines = []
  if (result.category === null) {
    lines.push('## CI failure attribution', '', 'No job failed.')
    return lines.join('\n')
  }
  lines.push(
    '## CI failure attribution',
    '',
    `**Category:** \`${result.category}\``,
    `**Blocking:** ${result.blocking ? 'yes' : 'no'}`,
    `**What to do:** ${result.action}`,
    '',
  )
  if (result.jobs.length > 0) {
    lines.push('| Job | Category | Blocking | Informational |', '| --- | --- | --- | --- |')
    for (const job of result.jobs) {
      lines.push(
        `| ${job.job} | \`${job.category}\` | ${job.blocking ? 'yes' : 'no'} | ${job.informational ? 'yes' : 'no'} |`,
      )
    }
  }
  return lines.join('\n')
}
