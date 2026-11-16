// T11 — check provenance. The defect: app id + name was treated as proof of source.
//
// GitHub Actions is ONE App for every workflow in the repository, so any workflow file
// can publish a check named `Rust quality`. The old selection rule accepted it.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findSpoofedChecks,
  groupByWorkflow,
  parseDetailsUrl,
  verifyCheckProvenance,
} from './check-run-provenance.mjs'

const COMMIT = 'a'.repeat(40)
const CI = '.github/workflows/ci.yml'

function checkRun({ name = 'Rust quality', runId = 1001, jobId = 5001, sha = COMMIT } = {}) {
  return {
    id: jobId,
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    // Every workflow publishes under the same app id. This is the field the old rule used.
    app: { id: 15368, name: 'GitHub Actions' },
    details_url: `https://github.com/baicie/terminal/actions/runs/${runId}/job/${jobId}`,
    check_suite: { id: 999 },
  }
}

function resolution({ path = CI, workflowId = 331087800, attempt = 1, sha = COMMIT, event = 'push' } = {}) {
  return { ok: true, path, workflowId, runAttempt: attempt, headSha: sha, event }
}

test('the real details_url is parsed into a run id and job id', () => {
  // Measured shape from run 43770018507 / job 132988523228.
  const parsed = parseDetailsUrl('https://github.com/baicie/terminal/actions/runs/43770018507/job/132988523228')
  assert.deepEqual(parsed, { runId: 43770018507, jobId: 132988523228 })
})

test('a non-Actions details_url yields null rather than a guess', () => {
  for (const url of [null, undefined, '', 'https://example.com/build/1', 'https://github.com/a/b/actions']) {
    assert.equal(parseDetailsUrl(url), null, String(url))
  }
})

test('a check from the right workflow on the right commit verifies', () => {
  const result = verifyCheckProvenance(checkRun(), resolution(), { workflowPath: CI })
  assert.equal(result.verified, true, JSON.stringify(result.problems))
  assert.equal(result.provenance.workflowPath, CI)
  assert.equal(result.provenance.runId, 1001)
})

test('another workflow publishing the same name is caught', () => {
  // The spoof: a new workflow file, same check name, always green.
  const result = verifyCheckProvenance(
    checkRun(),
    resolution({ path: '.github/workflows/pretend-green.yml' }),
    { workflowPath: CI },
  )
  assert.equal(result.verified, false)
  assert.ok(result.problems.some(problem => problem.code === 'provenance-wrong-workflow'))
})

test('a check run with no details URL is a provenance failure, not a pass', () => {
  const run = { ...checkRun(), details_url: null }
  const result = verifyCheckProvenance(run, resolution(), { workflowPath: CI })
  assert.equal(result.verified, false)
  assert.ok(result.problems.some(problem => problem.code === 'provenance-no-details-url'))
})

test('an unresolvable run is a provenance failure, and says why', () => {
  const result = verifyCheckProvenance(checkRun(), { ok: false, reason: 'FORBIDDEN' }, { workflowPath: CI })
  assert.equal(result.verified, false)
  assert.ok(result.problems.some(problem => problem.code === 'provenance-unresolvable'))
})

test('a run whose head differs from the check run head is caught', () => {
  const result = verifyCheckProvenance(checkRun(), resolution({ sha: 'b'.repeat(40) }), { workflowPath: CI })
  assert.equal(result.verified, false)
  assert.ok(result.problems.some(problem => problem.code === 'provenance-sha-mismatch'))
})

test('a run from the wrong event is caught when the gate restricts events', () => {
  const result = verifyCheckProvenance(checkRun(), resolution({ event: 'issue_comment' }), {
    workflowPath: CI,
    allowedEvents: ['push', 'pull_request'],
  })
  assert.equal(result.verified, false)
  assert.ok(result.problems.some(problem => problem.code === 'provenance-wrong-event'))
})

test('a rerun is verified with its attempt recorded', () => {
  // run_attempt 2 is the same workflow, a later try. Provenance holds; the attempt is
  // reported so a reader can tell the first failure from the re-run.
  const result = verifyCheckProvenance(checkRun({ runId: 1002 }), resolution({ attempt: 2 }), { workflowPath: CI })
  assert.equal(result.verified, true)
  assert.equal(result.provenance.runAttempt, 2)
})

test('several checks from one workflow are grouped together', () => {
  const entries = [
    { probe: 1, provenance: { name: 'Rust quality', workflowPath: CI } },
    { probe: 2, provenance: { name: 'Frontend quality', workflowPath: CI } },
    { probe: 3, provenance: { name: 'macOS GUI E2E', workflowPath: '.github/workflows/native-gui-e2e.yml' } },
  ]
  const groups = groupByWorkflow(entries)
  assert.equal(groups.get(CI).length, 2)
  assert.equal(groups.get('.github/workflows/native-gui-e2e.yml').length, 1)
})

test('a spoofed check is named with its expected and actual workflow', () => {
  const entries = [
    {
      provenance: { name: 'Rust quality', workflowPath: '.github/workflows/pretend.yml', runId: 7 },
    },
  ]
  const spoofed = findSpoofedChecks(entries, { 'Rust quality': CI })
  assert.equal(spoofed.length, 1)
  assert.deepEqual(
    { name: spoofed[0].name, expected: spoofed[0].expected, actual: spoofed[0].actual },
    { name: 'Rust quality', expected: CI, actual: '.github/workflows/pretend.yml' },
  )
})

test('a correctly-sourced check is not reported as spoofed', () => {
  const entries = [{ provenance: { name: 'Rust quality', workflowPath: CI } }]
  assert.deepEqual(findSpoofedChecks(entries, { 'Rust quality': CI }), [])
})
