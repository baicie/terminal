// The aggregate gate's contract, case by case.
//
// The failure modes this pins are the ones that make a required check worse than no
// required check: a gate that passes when a job was cancelled, or that hangs forever
// because it depends on a job `paths-ignore` never created.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  AGGREGATED_JOBS,
  EXPECTED_JOBS,
  classifyJob,
  decide,
  unclassifiedJobs,
} from './verify-required-checks.mjs'

/** A `needs` shape where every aggregated job succeeded. */
function allSuccess() {
  return Object.fromEntries(AGGREGATED_JOBS.map(job => [job, { result: 'success' }]))
}

test('every aggregated job succeeding passes', () => {
  const { ok, results } = decide(allSuccess())
  assert.equal(ok, true)
  assert.equal(results.every(r => r.verdict === 'ok'), true)
})

test('a failed job fails the gate', () => {
  const needs = allSuccess()
  needs.rust = { result: 'failure' }
  const { ok, results } = decide(needs)
  assert.equal(ok, false)
  assert.match(results.find(r => r.detail.startsWith('rust')).detail, /failure/)
})

test('a cancelled job fails the gate', () => {
  // The case a boolean `== 'success'` check would also catch, but which is worth
  // stating: a cancelled job did not finish, so it cannot stand for a pass.
  const needs = allSuccess()
  needs.tauri = { result: 'cancelled' }
  const { ok } = decide(needs)
  assert.equal(ok, false)
})

test('a skipped required job fails unless the run is docs-only', () => {
  const needs = allSuccess()
  needs['tauri'] = { result: 'skipped' }

  // Normal run: something was skipped that should have run.
  assert.equal(decide(needs).ok, false)

  // Docs-only run: `paths-ignore` filtered the whole workflow, so every job is
  // skipped. Failing here would make a README edit unmergeable.
  const docsOnly = Object.fromEntries(AGGREGATED_JOBS.map(job => [job, { result: 'skipped' }]))
  assert.equal(decide(docsOnly, { docsOnly: true }).ok, true)
})

test('a missing result fails — silence is not success', () => {
  // What a wiring bug looks like: the job exists but is not in `needs`, so
  // `toJSON(needs)` has no entry for it.
  const needs = allSuccess()
  delete needs.frontend
  const { ok, results } = decide(needs)
  assert.equal(ok, false)
  assert.match(results.find(r => r.detail.startsWith('frontend')).detail, /no result/)
})

test('an optional job may be absent or skipped', () => {
  const absent = classifyJob('zsh-probe-diagnostic', undefined, { optional: true })
  assert.equal(absent.verdict, 'skipped-ok')
  const skipped = classifyJob('zsh-probe-diagnostic', 'skipped', { optional: true })
  assert.equal(skipped.verdict, 'skipped-ok')
  // But it may not fail silently — a diagnostic that errored is still information,
  // and reporting it as `skipped-ok` would hide it.
  const failed = classifyJob('zsh-probe-diagnostic', 'failure', { optional: true })
  assert.equal(failed.verdict, 'failed')
})

test('an unknown result string is a failure, not a pass', () => {
  // GitHub could add a state; defaulting to pass would be the unsafe direction.
  assert.equal(classifyJob('rust', 'neutral', { optional: false }).verdict, 'failed')
  assert.equal(classifyJob('rust', '', { optional: false }).verdict, 'missing')
})

test('the aggregator is not required to depend on itself', () => {
  assert.equal(EXPECTED_JOBS.required.optional, true)
  assert.equal(AGGREGATED_JOBS.includes('required'), false)
  // The classifier is a real job and must succeed, but it is not aggregated: the
  // aggregator reads its *output*, not its result.
  assert.equal(EXPECTED_JOBS.changes.optional, false)
  assert.equal(AGGREGATED_JOBS.includes('changes'), false)
})

test('DOCS_ONLY accepts the value the workflow actually passes', async () => {
  // The job output is the string "true", not "1". An earlier version compared
  // against '1' only, which made the docs-only branch unreachable from CI — a
  // simulated docs-only run failed with "tauri: skipped but not optional".
  const { execFileSync } = await import('node:child_process')
  const needs = Object.fromEntries(AGGREGATED_JOBS.map(job => [job, { result: 'skipped' }]))
  needs.changes = { result: 'success' }
  const script = new URL('./verify-required-checks.mjs', import.meta.url).pathname
  const run = value =>
    execFileSync(process.execPath, [script], {
      env: { ...process.env, NEEDS: JSON.stringify(needs), DOCS_ONLY: value },
      encoding: 'utf8',
      stdio: 'pipe',
    })
  for (const value of ['true', '1', 'TRUE']) {
    assert.doesNotThrow(() => run(value), `DOCS_ONLY=${value} should be accepted`)
  }
  for (const value of ['false', '0', '']) {
    assert.throws(() => run(value), undefined, `DOCS_ONLY=${value} must not skip`)
  }
})

test('every job in ci.yml is classified', () => {
  // Reads the real workflow. A new job must be a deliberate addition to the contract,
  // not something that quietly stops being gated.
  const workflow = readFileSync(
    path.join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
    'utf8',
  )
  assert.deepEqual(unclassifiedJobs(workflow), [])
})

test('an unclassified job is reported', () => {
  const workflow = ['jobs:', '  frontend:', '    runs-on: ubuntu-latest', '  brand-new:', '    runs-on: ubuntu-latest'].join(
    '\n',
  )
  assert.deepEqual(unclassifiedJobs(workflow), ['brand-new'])
})
