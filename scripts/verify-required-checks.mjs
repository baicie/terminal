#!/usr/bin/env node
/**
 * Decide whether `CI / required` passes.
 *
 * ## Why this is a program and not `if: needs.x.result == 'success'`
 *
 * GitHub's `needs` context reports one of `success`, `failure`, `cancelled` or
 * `skipped` per job, and a job that never ran because `paths-ignore` filtered the
 * workflow out produces **no run at all** — not a `skipped` result. Those are three
 * different situations and a boolean expression collapses them:
 *
 * | Situation | Correct verdict |
 * | --- | --- |
 * | every expected job succeeded | pass |
 * | a docs-only change skipped everything | pass, and say so |
 * | a job failed | fail |
 * | a job was cancelled | fail — an unfinished check is not a passed one |
 * | a dependency was skipped so its dependents skipped | decide from the *reason* |
 * | an expected job has no result at all | fail — silence is not success |
 *
 * `EXPECTED` below is the contract. A job that exists in `ci.yml` and is not listed
 * here fails the gate: adding a job must be a deliberate act, not a silent widening
 * of what "CI passed" means.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * Every job `ci.yml` defines, and what its absence means.
 *
 * `optional` is for jobs whose absence is legitimate on some runs. Only
 * `zsh-probe-diagnostic` is optional: it is `continue-on-error: true` by design, it
 * is not part of `needs` of `required`, and AGENTS.md records that its success does
 * not constitute a product gate. Everything else must have run.
 */
export const EXPECTED_JOBS = {
  frontend: { optional: false },
  'frontend-audit': { optional: false },
  'team-server': { optional: false },
  'zsh-probe-diagnostic': { optional: true, reason: 'diagnostic; continue-on-error by design' },
  'source-size': { optional: false },
  rust: { optional: false },
  // F17 — real two-hop matrix against actual `sshd` daemons. Blocking: it asserts
  // deterministic attribution and pool-release facts, which is the only kind of claim
  // this repository lets a CI job gate on.
  'real-ssh-jump': { optional: false },
  'cargo-audit': { optional: false },
  docker: { optional: false },
  tauri: { optional: false },
  // The classifier runs first and its output decides the rest. It must succeed, but
  // it is not part of AGGREGATED_JOBS because `required` reads its *output* rather
  // than its result.
  changes: { optional: false },
  // `required` itself is the aggregator and never appears in its own `needs`.
  required: { optional: true, reason: 'the aggregator' },
  // ## The test execution report
  //
  // Reporting, not gating. It aggregates the per-layer test reports and is
  // `continue-on-error: true` by design, so its own failure must not turn a merge red —
  // the individual test jobs are the gates. It is listed here (rather than left
  // unclassified) so that changing it from advisory to blocking is a deliberate edit:
  // move it into AGGREGATED_JOBS *and* remove the continue-on-error.
  'test-report': {
    optional: true,
    reason: 'reporting only; continue-on-error by design, the per-layer jobs are the gates',
  },
}

/** Jobs whose results arrive through `needs` for the `required` job. */
export const AGGREGATED_JOBS = [
  'frontend',
  'frontend-audit',
  'team-server',
  'source-size',
  'rust',
  // F17 — the real two-hop matrix. Blocking, not advisory: it asserts deterministic
  // facts (which leg was blamed, whether the pool returned to zero), and a regression
  // there is exactly what the SSH book exists to prevent.
  'real-ssh-jump',
  'cargo-audit',
  'docker',
  'tauri',
]

/**
 * Classify one job result.
 *
 * Returns `{ verdict, detail }` where verdict is one of `ok`, `skipped-ok`,
 * `failed`, `missing`.
 */
export function classifyJob(job, result, { optional }) {
  if (result === undefined || result === null || result === '') {
    // No result at all. That happens when a job is not in `needs` (a wiring bug) or
    // when the workflow never produced it. Either way it is not a pass.
    return optional
      ? { verdict: 'skipped-ok', detail: `${job}: absent, optional` }
      : { verdict: 'missing', detail: `${job}: no result recorded` }
  }
  if (result === 'success') return { verdict: 'ok', detail: `${job}: success` }
  if (result === 'skipped') {
    return optional
      ? { verdict: 'skipped-ok', detail: `${job}: skipped, optional` }
      : { verdict: 'failed', detail: `${job}: skipped but not optional` }
  }
  if (result === 'cancelled') {
    // A cancelled job did not finish. Treating it as anything but a failure is how a
    // pushed-then-cancelled run would ship.
    return { verdict: 'failed', detail: `${job}: cancelled` }
  }
  return { verdict: 'failed', detail: `${job}: ${result}` }
}

/**
 * Decide the run.
 *
 * `needs` is `toJSON(needs)` from the workflow. `docsOnly` is derived from the
 * changed files when the caller has them; otherwise it stays false and a skipped
 * required job is a failure.
 */
/**
 * @param needs `toJSON(needs)` from the workflow
 * @param options.docsOnly whether the change classifier said documentation-only
 * @param options.expected the job contract
 *
 * `eventName` is accepted but **not** used, deliberately: a push to `main` and a PR
 * run must reach the same verdict from the same job results (T13). Anything that made
 * them differ would mean a merge commit could pass where its PR could not.
 */
export function decide(needs, { docsOnly = false, expected = EXPECTED_JOBS } = {}) {
  const results = []
  let failed = false

  for (const job of AGGREGATED_JOBS) {
    const result = needs?.[job]?.result
    // A docs-only run legitimately skips everything; that is the one case where an
    // expected job may be skipped without a per-job `optional` flag.
    const optional = expected[job]?.optional === true || docsOnly
    const verdict = classifyJob(job, result, { optional })
    results.push(verdict)
    if (verdict.verdict === 'failed' || verdict.verdict === 'missing') failed = true
  }

  return { ok: !failed, results, docsOnly }
}

/**
 * Jobs declared in `ci.yml` but not classified here.
 *
 * The gate fails on a non-empty answer: a new job that nobody decided about must not
 * silently count as "not required".
 */
export function unclassifiedJobs(workflowSource, expected = EXPECTED_JOBS) {
  const declared = []
  // Job keys are two-space indented keys directly under `jobs:`.
  const jobsBlock = workflowSource.split(/^jobs:\s*$/m)[1] ?? ''
  for (const line of jobsBlock.split('\n')) {
    const match = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line)
    if (match) declared.push(match[1])
  }
  return declared.filter(job => !(job in expected))
}

function main() {
  const needs = process.env.NEEDS ? JSON.parse(process.env.NEEDS) : {}
  // The workflow passes `needs.changes.outputs.docs_only`, which is the string
  // `'true'`, not `'1'`. Accepting only `'1'` made the docs-only branch unreachable
  // from CI — measured: a simulated docs-only run failed with "tauri: skipped but not
  // optional" even though every job had been skipped for that reason.
  const docsOnly = ['1', 'true'].includes(String(process.env.DOCS_ONLY ?? '').toLowerCase())

  const { ok, results } = decide(needs, { docsOnly })

  const workflow = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
  const unclassified = unclassifiedJobs(workflow)

  for (const result of results) console.log(`  ${result.verdict.padEnd(11)} ${result.detail}`)
  if (unclassified.length > 0) {
    console.log(`  ${'unclassified'.padEnd(11)} ${unclassified.join(', ')}`)
  }

  if (!ok) {
    console.error('CI / required: FAILED — see the per-job lines above')
    return 1
  }
  if (unclassified.length > 0) {
    console.error(
      `CI / required: FAILED — ${unclassified.join(', ')} exist in ci.yml but are not ` +
        'classified in scripts/verify-required-checks.mjs. Add them to EXPECTED_JOBS ' +
        '(and to needs/required if they should gate a merge) rather than leaving them ' +
        'outside the contract.',
    )
    return 1
  }
  console.log('CI / required: PASSED')
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
