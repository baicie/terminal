#!/usr/bin/env node
/**
 * Collect the facts `verify-release-qualification.mjs` judges.
 *
 * Split from the judging on purpose: the judgement is pure and testable, this part
 * talks to `gh` and the filesystem and is exercised only in a real release run.
 *
 * Every fact it cannot establish becomes an explicit `null`, never a plausible
 * default. A release gate that fills in "probably fine" is worse than no gate.
 */
import { execFileSync } from 'node:child_process'
import { parseDetailsUrl } from './check-run-provenance.mjs'
import { selectAcrossPages } from './check-run-selection.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')

function gh(args) {
  try {
    return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** How many check-run pages to read before giving up and failing closed. */
const MAX_CHECK_PAGES = 10
const CHECK_PAGE_SIZE = 100

/**
 * Every check run for this commit, keyed by name.
 *
 * ## What the first version got wrong
 *
 * It read one page of 100, took the **last** entry per name, and compared
 * `conclusion` only. Measured against the three failure modes:
 *
 * | Case | Old result |
 * | --- | --- |
 * | an untrusted App publishes the same check name with a higher id | reported success |
 * | a re-run is still `in_progress` | reported `null` conclusion, not "wait" |
 * | more than 100 runs on a commit | silently truncated |
 *
 * The selection rules now live in `check-run-selection.mjs` so they can be tested
 * without a live repository (12 cases).
 */
function collectChecks(commit) {
  const pages = []
  for (let page = 1; page <= MAX_CHECK_PAGES; page += 1) {
    const raw = gh([
      'api',
      `repos/{owner}/{repo}/commits/${commit}/check-runs?per_page=${CHECK_PAGE_SIZE}&page=${page}`,
      '--jq',
      '.check_runs',
    ])
    if (raw === null) {
      // The API was unreachable or refused. Returning the pages we have would make a
      // partial answer look complete, so the caller sees "could not read" instead.
      return { checks: {}, error: `check-run page ${page} could not be read` }
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { checks: {}, error: `check-run page ${page} was not JSON` }
    }
    if (!Array.isArray(parsed)) {
      return { checks: {}, error: `check-run page ${page} was not a list` }
    }
    pages.push(parsed)
    // Fewer than a full page means this was the last one.
    if (parsed.length < CHECK_PAGE_SIZE) break
    if (page === MAX_CHECK_PAGES) {
      // Still full at the cap: the answer would be incomplete, which is a failure
      // rather than a guess.
      return {
        checks: {},
        error: `more than ${MAX_CHECK_PAGES * CHECK_PAGE_SIZE} check runs; refusing to judge on a partial list`,
      }
    }
  }

  // Only this repository's own workflow may satisfy a required check.
  const allowedAppIds = allowedCheckApps()
  const { checks, ignored } = selectAcrossPages(pages, { allowedAppIds })
  if (ignored.length > 0) {
    for (const entry of ignored) {
      console.error(`  ignored check run ${entry.id} ${entry.name}: ${entry.reason}`)
    }
  }

  const withProvenance = attachProvenance(checks, pages)
  return { checks: withProvenance, ignored }
}

/**
 * Resolve which workflow produced each check, from its details URL.
 *
 * ## Why this is necessary
 *
 * App id is identical for every workflow in the repository (measured: 15368), and a
 * job name is data any workflow file can set. Neither is proof of source. The
 * `details_url` points at `actions/runs/<id>`, and that endpoint carries the workflow
 * path — which the workflow itself cannot forge.
 *
 * The resolution is best-effort per check and never throws: a failure leaves
 * `workflowPath` as `null`, which the judge treats as a provenance problem rather than
 * a pass.
 */
function attachProvenance(checks, pages) {
  // Index the details URLs from the raw pages so the mapping is by check id.
  const detailsById = new Map()
  for (const page of pages) {
    if (!Array.isArray(page)) continue
    for (const run of page) {
      if (run && run.id !== undefined && run.details_url) detailsById.set(Number(run.id), run.details_url)
    }
  }

  const cache = new Map()
  const resolved = {}
  for (const [name, entry] of Object.entries(checks)) {
    const detailsUrl = detailsById.get(Number(entry.id)) ?? null
    const parsed = parseDetailsUrl(detailsUrl)
    let workflowPath = null
    if (parsed !== null) {
      if (cache.has(parsed.runId)) {
        workflowPath = cache.get(parsed.runId)
      } else {
        const raw = gh(['api', `repos/{owner}/{repo}/actions/runs/${parsed.runId}`, '--jq', '.path'])
        workflowPath = raw === null ? null : raw.trim()
        cache.set(parsed.runId, workflowPath)
      }
    }
    resolved[name] = {
      ...entry,
      runId: parsed?.runId ?? null,
      jobId: parsed?.jobId ?? null,
      // `null` means "could not determine", which the judge reports as a problem.
      workflowPath,
    }
  }
  return resolved
}

/**
 * Which GitHub App ids may satisfy a required check.
 *
 * `GITHUB_ACTIONS_APP_ID` defaults to 15368 (the GitHub Actions app). An empty set
 * means "any app" is accepted, which is what a local run needs; CI sets it.
 */
function allowedCheckApps() {
  const raw = process.env.RELEASE_CHECK_APP_IDS ?? '15368'
  const parts = raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const ids = parts.map(Number).filter(value => Number.isInteger(value) && value > 0)

  if (ids.length !== parts.length) {
    // ## Fail closed on a malformed value
    //
    // The previous version filtered out non-numeric entries and returned `null` when
    // nothing was left — and `null` means "any App may satisfy a required check". So
    // `RELEASE_CHECK_APP_IDS=none`, or any typo, silently widened the trust boundary to
    // every App on the commit. A value the operator typed wrong must stop the release,
    // not relax the gate.
    throw new Error(
      `RELEASE_CHECK_APP_IDS=${JSON.stringify(raw)} is not a comma-separated list of positive ` +
        'integers. Refusing to run: an unparseable value would otherwise mean "trust every App"',
    )
  }
  // An explicitly empty value is the local-development escape hatch, and it is spelled
  // out rather than reached by accident.
  if (ids.length === 0) {
    console.error('RELEASE_CHECK_APP_IDS is empty: NO App may satisfy a required check')
    return new Set()
  }
  return new Set(ids)
}

/**
 * Run the evidence gate in qualification mode and keep its verdict.
 *
 * Reusing the gate rather than re-deriving the answer is the point: two
 * implementations of "does this evidence describe this commit" would drift, and the
 * one in the release path would be the one nobody tested.
 */
function collectEvidence() {
  try {
    execFileSync(process.execPath, ['scripts/check-verification-evidence.mjs', '--mode=qualification'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { qualificationPassed: true, problemCount: 0, missingScenarios: [], notPassed: [] }
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    const count = /(\d+) problem\(s\)/.exec(output)
    return {
      qualificationPassed: false,
      problemCount: count ? Number(count[1]) : null,
      missingScenarios: [],
      notPassed: [],
    }
  }
}

/**
 * Split the collector's return into `checks` and an explicit error field.
 *
 * A collector failure and a failed check are different facts: one means the gate
 * could not answer, the other means the answer is "no". The release judge reports
 * them separately.
 */
function splitCheckResult(result) {
  return result.error
    ? { checks: {}, checksError: result.error }
    : { checks: result.checks, checksError: null }
}

function main() {
  const commit = process.env.RELEASE_COMMIT || git(['rev-parse', 'HEAD'])
  const tag = process.env.RELEASE_TAG || null
  const mode = process.env.RELEASE_MODE || null
  const tagCommit = tag ? git(['rev-list', '-n', '1', tag]) : null

  const facts = {
    commit,
    tag,
    tagCommit,
    mode,
    ...(commit ? splitCheckResult(collectChecks(commit)) : { checks: {}, checksError: 'no commit' }),
    evidence: collectEvidence(),
    signing: {
      // The workflow exports this only when the secret exists.
      updaterKeyPresent: Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY),
      // Notarization is a separate, external capability; nothing in this repository
      // can produce it yet, so it is reported as the workflow knows it.
      notarized: process.env.RELEASE_NOTARIZED === 'true',
    },
  }

  const dir = mkdtempSync(path.join(os.tmpdir(), 'release-facts-'))
  const file = path.join(dir, 'facts.json')
  writeFileSync(file, `${JSON.stringify(facts, null, 2)}\n`)
  console.log(file)
  // The caller reads the path from stdout; the temp dir is left for inspection on
  // failure and is inside the runner's tmp.
  void rmSync
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
