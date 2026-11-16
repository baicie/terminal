/**
 * Prove where a check run came from, not just that its name matched.
 *
 * ## The gap this closes
 *
 * `check-run-selection.mjs` accepted a check named `Rust quality` if its `app.id` was
 * GitHub Actions. That is one App for **every workflow in the repository**, so:
 *
 * ```yaml
 * # .github/workflows/anything.yml — a file anyone can add
 * jobs:
 *   pretend:
 *     name: Rust quality          # same name
 *     runs-on: ubuntu-latest
 *     steps: [{ run: 'true' }]    # always green
 * ```
 *
 * publishes a check run that satisfies the required-check set. The old rule could not
 * distinguish it from the real job. App id is not provenance.
 *
 * ## What the API actually gives us
 *
 * Measured on a real commit (`bc53cf1`):
 *
 * | Field | Present? |
 * | --- | --- |
 * | `check_run.app.id` | yes — but identical for every workflow |
 * | `check_run.name` | yes — forgeable by any workflow |
 * | `check_suite.id` | yes — but `check_suite.app`, `.head_sha` come back **null** |
 * | `check_run.details_url` | yes — `…/actions/runs/<run>/job/<job>` |
 * | `actions/runs/<run>.path` | yes — `.github/workflows/ci.yml` |
 * | `actions/runs/<run>.workflow_id` | yes |
 * | `actions/runs/<run>.run_attempt` | yes |
 *
 * `check_suite` carrying nulls was the surprise, and it is why one must not assume the
 * suite can be used to resolve the workflow. The usable chain is `details_url`.
 *
 * ## What is proven, and what is not
 *
 * The URL is supplied by GitHub, not by the workflow, so a workflow cannot forge
 * another workflow's run id. Resolving it gives the workflow path, which is what makes
 * "this check came from ci.yml" a verifiable statement rather than an assumption.
 */

/** A `check_run.details_url`, which is the only reliable route to the run. */
const DETAILS_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/

/**
 * Parse the run id (and job id) out of a details URL.
 *
 * Returns `null` when the URL is absent or not an Actions run URL. A null here is a
 * *provenance failure*, not a reason to fall back to the name.
 */
export function parseDetailsUrl(url) {
  const match = DETAILS_URL.exec(String(url ?? ''))
  if (!match) return null
  return {
    runId: Number(match[1]),
    jobId: match[2] === undefined ? null : Number(match[2]),
  }
}

/**
 * Decide whether a check run is a trustworthy source for a required check.
 *
 * `resolution` is what the caller learned by fetching `actions/runs/<runId>`:
 * `{ok, path, workflowId, runAttempt, headSha, event}`. A resolution failure yields
 * `verified: false` with the reason — never a pass.
 *
 * `expected` describes what the contract says the check must be:
 * `{workflowPath, jobName, allowAnyWorkflow?}`.
 */
export function verifyCheckProvenance(checkRun, resolution, expected) {
  const problems = []
  const provenance = {
    checkRunId: checkRun?.id ?? null,
    name: checkRun?.name ?? null,
    appId: checkRun?.app?.id ?? null,
    headSha: checkRun?.head_sha ?? null,
    runId: null,
    jobId: null,
    workflowPath: null,
    workflowId: null,
    runAttempt: null,
  }

  const parsed = parseDetailsUrl(checkRun?.details_url)
  if (parsed === null) {
    problems.push({
      code: 'provenance-no-details-url',
      message:
        'the check run has no Actions run URL, so its originating workflow cannot be ' +
        'determined; a check name alone is not provenance',
    })
    return { verified: false, problems, provenance }
  }
  provenance.runId = parsed.runId
  provenance.jobId = parsed.jobId

  if (resolution === null || resolution === undefined || resolution.ok !== true) {
    problems.push({
      code: 'provenance-unresolvable',
      message:
        `run ${parsed.runId} could not be read (${resolution?.reason ?? 'unknown'}), so ` +
        'the workflow that produced this check is unknown',
    })
    return { verified: false, problems, provenance }
  }

  provenance.workflowPath = resolution.path ?? null
  provenance.workflowId = resolution.workflowId ?? null
  provenance.runAttempt = resolution.runAttempt ?? null

  if (!provenance.workflowPath) {
    problems.push({
      code: 'provenance-no-workflow-path',
      message: `run ${parsed.runId} reported no workflow path`,
    })
  } else if (expected?.workflowPath && provenance.workflowPath !== expected.workflowPath) {
    problems.push({
      code: 'provenance-wrong-workflow',
      message:
        `check ${JSON.stringify(checkRun?.name)} came from ${provenance.workflowPath}, ` +
        `not from ${expected.workflowPath}`,
    })
  }

  // The run must have produced the commit being released, not just the check run's
  // own head_sha (which a re-run can set independently).
  if (resolution.headSha && checkRun?.head_sha && resolution.headSha !== checkRun.head_sha) {
    problems.push({
      code: 'provenance-sha-mismatch',
      message:
        `check run says ${checkRun.head_sha} but its workflow run says ${resolution.headSha}`,
    })
  }

  if (resolution.event && expected?.allowedEvents && !expected.allowedEvents.includes(resolution.event)) {
    problems.push({
      code: 'provenance-wrong-event',
      message:
        `check came from a ${resolution.event} run; this gate accepts ` +
        `${expected.allowedEvents.join('/')}`,
    })
  }

  return { verified: problems.length === 0, problems, provenance }
}

/**
 * Group check runs by the workflow that produced them.
 *
 * Used to answer "did each required check come from a *distinct* real job, or did one
 * workflow publish several names?" — the latter is the spoofing shape.
 */
export function groupByWorkflow(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = entry.provenance?.workflowPath ?? '<unknown>'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  return groups
}

/**
 * Detect a workflow publishing a check name it does not own.
 *
 * `expectedOwners` maps check name -> workflow path. A check whose name is in the map
 * but whose provenance names a different workflow is the spoof.
 */
export function findSpoofedChecks(entries, expectedOwners) {
  const spoofed = []
  for (const entry of entries) {
    const name = entry.provenance?.name ?? entry.check?.name
    const expected = expectedOwners[name]
    if (expected === undefined) continue
    if (entry.provenance?.workflowPath !== expected) {
      spoofed.push({
        name,
        expected,
        actual: entry.provenance?.workflowPath ?? null,
        runId: entry.provenance?.runId ?? null,
      })
    }
  }
  return spoofed
}
