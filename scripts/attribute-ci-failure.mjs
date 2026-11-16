#!/usr/bin/env node
/**
 * Print the failure attribution for one CI run.
 *
 * ## What this used to do
 *
 * It read a pre-shaped JSON array, fetched `actions/jobs/${job.id}/logs` for each
 * failing job, and swallowed every error. The workflow built that array with a `jq`
 * projection that **did not include `id`**, so every fetch was
 * `.../jobs/undefined/logs`, every one 404'd, and every job was classified from its
 * name alone. On real run 43716684905 the Windows build failed with
 * `error[E0433]: cannot find \`unix\` in \`os\`` and the report said `UNKNOWN`.
 *
 * ## What it does now
 *
 *  - reads the run's **real** conclusion from the Runs API instead of inferring it
 *    from the jobs it happened to receive;
 *  - keeps `id`, so a log can actually be requested;
 *  - reads every page of the job list;
 *  - classifies informational jobs by an allowlist, not a substring of the name;
 *  - reports `LOG_UNAVAILABLE` with a reason rather than an empty cell;
 *  - keeps classification and merge eligibility as separate facts.
 *
 * ## Two modes
 *
 * `--jobs <file>` reads a job list (the workflow's existing path; a fixture in tests).
 * `--api` fetches everything itself through the injected adapter.
 *
 * Usage:
 *   node scripts/attribute-ci-failure.mjs --jobs /tmp/jobs.json [--run-conclusion failure]
 *   node scripts/attribute-ci-failure.mjs --api --run-id 123 [--repo owner/name]
 *
 * Exit codes: 0 report written, 1 the report could not be produced.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { classifyRun } from './ci-failure-attribution.mjs'
import { renderReport } from './ci-failure-report.mjs'
import { createGhApi, normaliseJob, failingSteps } from './ci-github-api.mjs'
import { informationalFor } from './ci-informational.mjs'
import { loadKnownIssueSources } from './ci-known-issue-sources.mjs'

/** How the tests substitute a fake `gh`. */
export function makeRunner({ ghBinary = 'gh', timeoutMs = 60_000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  return (args, options = {}) =>
    execFileSync(ghBinary, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: options.maxBuffer ?? maxBuffer,
      timeout: options.timeoutMs ?? timeoutMs,
    })
}

/**
 * Read the failing steps' portion of a log.
 *
 * The whole job log is dominated by setup noise (`Downloaded`, `Compiling`, the
 * runner's own cleanup). The previous version kept only the last 4000 characters,
 * which on a long build is the post-job cleanup rather than the error.
 *
 * ## Measured failure this fixes
 *
 * The first version of this function took the **first** anchor and returned
 * everything after it. On real job 132820499497 the first `##[error]` line is the
 * runner's `Process completed with exit code 1` at the very end, five lines before
 * EOF — so the excerpt was the cleanup tail and the actual
 * `error[E0433]: cannot find \`unix\` in \`os\`` at line 1558 was cut off. The report
 * said `UNKNOWN`, the log said PRODUCT_REGRESSION, and the tests passed because they
 * used a short synthetic log where the first anchor was also the real error.
 *
 * Now every anchor window is collected, and the windows are concatenated. Cheap,
 * and it cannot silently drop the error.
 */
export function extractFailureExcerpt(logText, { stepNames = [], maxChars = 12_000, windowLines = 40 } = {}) {
  if (!logText) return ''
  const lines = String(logText).split('\n')

  const anchors = new Set()
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    // Compiler/linter errors and the runner's own error markers.
    if (/##\[error\]/.test(line)) anchors.add(i)
    if (/(^|\s)error(\[E\d+\])?:/.test(line.replace(/\u001b\[[0-9;]*m/g, ''))) anchors.add(i)
    if (/panicked at/.test(line)) anchors.add(i)
    if (/test result: FAILED/.test(line)) anchors.add(i)
    if (stepNames.some(name => name && line.includes('##[group]') && line.includes(name))) anchors.add(i)
  }

  if (anchors.size === 0) {
    // No markers: the tail, but a longer tail than 4000 characters so a Rust error's
    // surrounding context survives.
    return String(logText).slice(-maxChars)
  }

  // Include a window around each anchor so the surrounding context is present, then
  // de-duplicate while preserving order.
  const included = new Set()
  for (const index of anchors) {
    for (let i = Math.max(0, index - 5); i <= Math.min(lines.length - 1, index + windowLines); i += 1) {
      included.add(i)
    }
  }
  const ordered = [...included].sort((a, b) => a - b)
  return ordered
    .map(index => lines[index])
    .join('\n')
    .slice(-maxChars)
}

/**
 * Build the report for a list of raw job objects plus a run conclusion.
 *
 * Separate from `main` so the tests can drive the exact orchestration the workflow
 * runs, including the log-fetch step, using a fake API.
 */
export function attributeJobs({
  rawJobs,
  runConclusion,
  workflowFile = '.github/workflows/ci.yml',
  api = null,
  knownIssueSources = {},
  requiredCheckFailed = null,
  readLog = null,
}) {
  const jobs = []
  for (const raw of rawJobs) {
    const job = normaliseJob(raw)
    if (job === null) continue
    const allow = informationalFor(workflowFile, job.name)
    job.informational = allow.informational
    job.allowlistKnown = allow.known

    // Only jobs that did not succeed need a log. A successful job's log cannot
    // explain a failure and fetching it wastes the rate limit.
    const needsLog = job.conclusion !== null && job.conclusion !== 'success' && job.conclusion !== 'skipped'
    if (needsLog && readLog) {
      const result = readLog(job)
      job.logText = extractFailureExcerpt(result.text ?? '', { stepNames: failingSteps(job) })
      job.logStatus = result.ok ? 'ok' : result.reason
    } else if (needsLog) {
      job.logStatus = job.id === null ? 'MISSING_JOB_ID' : 'DOWNLOAD_FAILED'
    }
    jobs.push(job)
  }

  return classifyRun({
    jobs,
    conclusion: runConclusion,
    knownIssueSources,
    requiredCheckFailed,
  })
}

/** Resolve the run's own conclusion when the caller did not supply it. */
function resolveRunConclusion({ api, runId, given }) {
  if (given !== null && given !== undefined && given !== '') return { conclusion: given, run: null }
  if (api === null || runId === null || runId === undefined) return { conclusion: null, run: null }
  const result = api.run(runId)
  if (!result.ok) return { conclusion: null, run: null, error: result.reason }
  return { conclusion: result.run.conclusion, run: result.run }
}

function parseArgs(argv) {
  const options = {
    jobsPath: null,
    runId: null,
    useApi: false,
    runConclusion: null,
    workflowFile: '.github/workflows/ci.yml',
    repo: process.env.REPO ?? null,
    requiredCheckFailed: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--jobs') options.jobsPath = argv[++i]
    else if (arg === '--api') options.useApi = true
    else if (arg === '--run-id') options.runId = argv[++i]
    else if (arg === '--run-conclusion') options.runConclusion = argv[++i]
    else if (arg === '--workflow-file') options.workflowFile = argv[++i]
    else if (arg === '--repo') options.repo = argv[++i]
    else if (arg === '--required-failed') options.requiredCheckFailed = argv[++i] === 'true'
    else if (!arg.startsWith('--') && options.jobsPath === null) options.jobsPath = arg
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.repo) process.env.REPO = options.repo

  const runUrl =
    options.runId && process.env.REPO
      ? `https://github.com/${process.env.REPO}/actions/runs/${options.runId}`
      : null

  let rawJobs = []
  let conclusion = options.runConclusion

  // The adapter is built in **both** modes. `--jobs` supplies the job list, but the
  // log still has to be fetched, and that is the same code path in both cases — the
  // previous version only fetched logs through a separate, untested `execFileSync`.
  const api = createGhApi(makeRunner())

  if (options.jobsPath !== null) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path.resolve(options.jobsPath), 'utf8'))
    } catch (error) {
      console.log(
        '## CI failure attribution\n\nCould not read the job list: ' + error.message + `\n\nRun: ${runUrl ?? 'unknown'}`,
      )
      return 1
    }
    // Accept both the bare array the workflow writes and `{jobs: [...]}`.
    rawJobs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : null
    if (rawJobs === null) {
      console.log(
        '## CI failure attribution\n\nThe job list was neither an array nor a `{jobs: [...]}` object.' +
          `\n\nRun: ${runUrl ?? 'unknown'}`,
      )
      return 1
    }
    if (conclusion === null && parsed?.conclusion) conclusion = parsed.conclusion
  } else if (options.useApi && options.runId !== null) {
    const listed = api.listJobs(options.runId)
    rawJobs = listed.jobs
    if (!listed.complete) {
      // Fall through with what was read, but the report will say the list is short.
      console.error(`job list was incomplete: ${JSON.stringify(listed.problems)}`)
    }
  } else {
    console.error('usage: attribute-ci-failure.mjs --jobs <jobs.json> | --api --run-id <id>')
    return 2
  }

  const resolved = resolveRunConclusion({ api, runId: options.runId, given: conclusion })

  let knownIssueSources = {}
  try {
    knownIssueSources = loadKnownIssueSources()
  } catch {
    // No documentation available: every KNOWN_ISSUE claim becomes UNKNOWN, which is
    // the safe direction.
    knownIssueSources = {}
  }

  const result = attributeJobs({
    rawJobs,
    runConclusion: resolved.conclusion,
    workflowFile: options.workflowFile,
    api,
    knownIssueSources,
    requiredCheckFailed: options.requiredCheckFailed,
    readLog: job => api.jobLog(job.id),
  })

  console.log(renderReport(result, { runUrl }))
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
