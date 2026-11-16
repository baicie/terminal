/**
 * The GitHub Actions API, behind an interface a test can fake.
 *
 * ## Why an adapter instead of `execFileSync('gh', …)` inline
 *
 * The previous CLI called `gh` directly from the reporting path. That made every
 * failure mode untestable, and it hid the one that actually happened:
 *
 *   `.github/workflows/ci.yml` built the job list with
 *   `jq '[.jobs[] | {name, conclusion, informational}]'`,
 *   which **drops `id`**, and `attribute-ci-failure.mjs` fetched logs with
 *   `actions/jobs/${job.id}/logs`. With `job.id === undefined` every URL was
 *   `.../jobs/undefined/logs`, every request 404'd, the `catch` swallowed it, and
 *   `classifyRun` saw empty `logText` for every job.
 *
 * Measured on real run 43716684905: the Windows build failed with
 * `error[E0433]: cannot find \`unix\` in \`os\`` — an unambiguous PRODUCT_REGRESSION —
 * and the report printed `UNKNOWN` for both failing jobs. The tool looked like it was
 * working and told the reader nothing.
 *
 * The adapter is split in two so each half can be wrong independently:
 *
 *   `createGhApi(runner)`  — transport. Returns a classified error, never throws.
 *   `collectRunFacts(api, …)` — pure-ish orchestration over that transport.
 */

import { LOG_UNAVAILABLE_REASONS } from './ci-log-status.mjs'

/** The default per-request timeout. A hung log download must not hang the job. */
const DEFAULT_TIMEOUT_MS = 60_000

/** The largest log we will read. GitHub caps job logs, but not redirects. */
const DEFAULT_MAX_LOG_BYTES = 32 * 1024 * 1024

/**
 * Classify a failed `gh` invocation.
 *
 * `gh` exits non-zero for every HTTP problem and puts the status in stderr, so the
 * status has to be recovered from the message rather than from an exception type.
 * An unclassifiable failure is `DOWNLOAD_FAILED`, not "no log" — the caller must be
 * able to tell "there is no log" from "I could not ask".
 */
export function classifyGhError(error) {
  const message = String(error?.stderr ?? error?.message ?? '')
  if (/\b403\b|forbidden|resource not accessible/i.test(message)) return 'FORBIDDEN'
  if (/\b404\b|not found/i.test(message)) return 'NOT_FOUND'
  if (/\b410\b|gone|expired/i.test(message)) return 'EXPIRED'
  if (/\b429\b|rate limit|secondary rate/i.test(message)) return 'RATE_LIMITED'
  if (/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(message)) return 'DOWNLOAD_FAILED'
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|network/i.test(message)) return 'DOWNLOAD_FAILED'
  return 'DOWNLOAD_FAILED'
}

/**
 * Build the API surface.
 *
 * `runner(args, options)` must return stdout as a string and throw on failure. It is
 * injected so the fake in the tests is the *only* difference between a fixture run
 * and a live one — there is no second code path that only CI exercises.
 */
export function createGhApi(runner, { timeoutMs = DEFAULT_TIMEOUT_MS, maxLogBytes = DEFAULT_MAX_LOG_BYTES } = {}) {
  /**
   * List every job of a run, across pages.
   *
   * `per_page=100` is the maximum. The previous version requested one page and would
   * have silently truncated a run with more than 100 jobs — which this repository can
   * reach with a matrix build.
   */
  function listJobs(runId, { maxPages = 20 } = {}) {
    const jobs = []
    const problems = []
    let satisfied = false
    for (let page = 1; page <= maxPages; page += 1) {
      let raw
      try {
        raw = runner([
          'api',
          `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
        ])
      } catch (error) {
        problems.push({ page, reason: classifyGhError(error) })
        return { jobs, problems, complete: false }
      }
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        problems.push({ page, reason: 'MALFORMED_RESPONSE' })
        return { jobs, problems, complete: false }
      }
      const pageJobs = Array.isArray(parsed?.jobs) ? parsed.jobs : null
      if (pageJobs === null) {
        problems.push({ page, reason: 'MALFORMED_RESPONSE' })
        return { jobs, problems, complete: false }
      }
      jobs.push(...pageJobs)
      // `total_count` is authoritative when present. A short page with a larger
      // `total_count` means the server paged inconsistently — not that the list is
      // complete — so keep asking until the count is satisfied or the cap is hit.
      const total = Number(parsed.total_count)
      if (Number.isFinite(total)) {
        if (jobs.length >= total) {
          satisfied = true
          break
        }
        continue
      }
      // No count available: a short page is the only end-of-list signal we have.
      if (pageJobs.length < 100) {
        satisfied = true
        break
      }
    }
    if (!satisfied) {
      // The page cap was reached before the list was satisfied. That is a partial
      // answer and must not be reported as a complete one — a truncated list can hide
      // the failing job entirely.
      problems.push({ page: maxPages, reason: 'PAGE_LIMIT_REACHED' })
    }
    return { jobs, problems, complete: satisfied }
  }

  /**
   * Read one job's log.
   *
   * Returns `{ ok, text, reason }`. `ok: false` always carries a reason from
   * `LOG_UNAVAILABLE_REASONS` so the report can say *why* it has no log instead of
   * printing an empty cell that reads like "the log was empty".
   */
  function jobLog(jobId) {
    if (jobId === null || jobId === undefined) return { ok: false, text: '', reason: 'MISSING_JOB_ID' }
    const id = Number(jobId)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, text: '', reason: 'MALFORMED_JOB_ID' }

    let text
    try {
      text = runner(['api', `repos/{owner}/{repo}/actions/jobs/${id}/logs`], {
        timeoutMs,
        maxBuffer: maxLogBytes,
        followRedirects: true,
      })
    } catch (error) {
      return { ok: false, text: '', reason: classifyGhError(error) }
    }
    if (text === '' || text === null || text === undefined) {
      return { ok: false, text: '', reason: 'EMPTY' }
    }
    if (Buffer.byteLength(String(text), 'utf8') > maxLogBytes) {
      // Keep the tail: the failure is at the end, and refusing the whole log would
      // throw away the only part that classifies.
      return { ok: true, text: String(text).slice(-maxLogBytes), reason: 'TOO_LARGE' }
    }
    return { ok: true, text: String(text), reason: null }
  }

  /** The workflow run itself — its real conclusion, not one inferred from jobs. */
  function run(runId) {
    let raw
    try {
      raw = runner(['api', `repos/{owner}/{repo}/actions/runs/${runId}`])
    } catch (error) {
      return { ok: false, reason: classifyGhError(error) }
    }
    try {
      const parsed = JSON.parse(raw)
      return {
        ok: true,
        run: {
          id: parsed.id,
          conclusion: parsed.conclusion ?? null,
          status: parsed.status ?? null,
          attempt: parsed.run_attempt ?? null,
          event: parsed.event ?? null,
          headSha: parsed.head_sha ?? null,
          workflowId: parsed.workflow_id ?? null,
          htmlUrl: parsed.html_url ?? null,
        },
      }
    } catch {
      return { ok: false, reason: 'MALFORMED_RESPONSE' }
    }
  }

  return { listJobs, jobLog, run }
}

/**
 * The shape the workflow should hand over.
 *
 * Kept as a named export so the workflow's `jq` expression and this contract can be
 * compared by a test. The list of fields is the fix for T01: `id` first, because its
 * absence is what broke log fetching, and a regression test asserts the workflow file
 * still emits it.
 */
export const JOB_LIST_FIELDS = ['id', 'name', 'conclusion', 'status', 'html_url', 'run_id', 'run_attempt']

/** A job entry as the report consumes it. */
export function normaliseJob(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = Number(raw.id)
  return {
    id: Number.isInteger(id) && id > 0 ? id : null,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : '<unnamed job>',
    conclusion: raw.conclusion ?? null,
    status: raw.status ?? null,
    htmlUrl: raw.html_url ?? raw.htmlUrl ?? null,
    runId: raw.run_id ?? raw.runId ?? null,
    runAttempt: raw.run_attempt ?? raw.runAttempt ?? null,
    // The allowlist decides this, not a substring of the name.
    informational: raw.informational === true,
    steps: Array.isArray(raw.steps) ? raw.steps : [],
  }
}

/** Extract the failing step names from a job, which is what the log tail should come from. */
export function failingSteps(job) {
  return (job.steps ?? [])
    .filter(step => step.conclusion === 'failure' || step.conclusion === 'timed_out')
    .map(step => step.name)
}

export { LOG_UNAVAILABLE_REASONS }
