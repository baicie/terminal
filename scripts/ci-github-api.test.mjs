// T01/T02 — the workflow's job projection and permissions, asserted against the code.
//
// The defect this locks down lived in a `jq` expression inside `ci.yml`, which no unit
// test could see. Two tests were needed:
//
//   * the adapter must keep the id (`JOB_LIST_FIELDS`);
//   * the workflow must emit every one of those fields.
//
// Before the fix, the second test's premise was false: `id` was not in the projection,
// so every log fetch was `jobs/undefined/logs`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { JOB_LIST_FIELDS, createGhApi, classifyGhError, failingSteps, normaliseJob } from './ci-github-api.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const CI = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')

test('the ci.yml job projection emits every field the adapter needs', () => {
  // Pull the `--jq` object literal out of the attribution step.
  const match = /--jq '\.jobs\[\] \| \{([^}]*)\}'/.exec(CI)
  assert.ok(match, 'the attribution step no longer projects an explicit field list')
  const emitted = match[1].split(',').map(field => field.trim())
  for (const field of JOB_LIST_FIELDS) {
    assert.ok(emitted.includes(field), `ci.yml drops \`${field}\`, which the CLI needs`)
  }
  // The one that was actually missing.
  assert.ok(emitted.includes('id'), 'job id must be projected — without it no log can be fetched')
})

test('the attribution job has actions:read, and nothing more', () => {
  const permissions = /^permissions:\n((?:\s{2}\S.*\n)+)/m.exec(CI)
  assert.ok(permissions, 'ci.yml has no top-level permissions block')
  const block = permissions[1]
  assert.match(block, /actions:\s*read/, 'the jobs and logs APIs need actions:read')
  assert.doesNotMatch(block, /actions:\s*write/, 'write is not needed and must not be granted')
  assert.doesNotMatch(block, /contents:\s*write/)
})

test('the attribution step passes the run conclusion instead of inferring it', () => {
  // `--run-conclusion` is what makes `cancelled`/`timed_out` distinguishable.
  assert.match(CI, /--run-conclusion/, 'the CLI must receive the real run conclusion')
  assert.match(CI, /actions\/runs\/\$\{RUN_ID\}.*conclusion/, 'the conclusion must come from the Runs API')
})

test('the attribution step pages the job list', () => {
  // One page of 100 silently truncates a large matrix run.
  assert.match(CI, /gh api --paginate .*actions\/runs\/\$\{RUN_ID\}\/jobs/, 'the job list must be paginated')
})

test('a job id survives normalisation', () => {
  const job = normaliseJob({ id: 12345, name: 'Rust quality', conclusion: 'failure', status: 'completed' })
  assert.equal(job.id, 12345)
  assert.equal(job.name, 'Rust quality')
})

test('a missing or invalid id becomes null, not a guess', () => {
  for (const raw of [{ name: 'x' }, { id: 'abc', name: 'x' }, { id: -1, name: 'x' }, { id: 0, name: 'x' }]) {
    assert.equal(normaliseJob(raw).id, null, JSON.stringify(raw))
  }
})

test('the failing steps are extracted BY NAME, from the job the API returned', () => {
  const job = normaliseJob({
    id: 1,
    name: 'Tauri build (windows-latest)',
    conclusion: 'failure',
    steps: [
      { name: 'Checkout', conclusion: 'success' },
      { name: 'Build', conclusion: 'failure' },
      { name: 'Upload', conclusion: 'skipped' },
      { name: 'Test', conclusion: 'timed_out' },
    ],
  })
  assert.deepEqual(failingSteps(job), ['Build', 'Test'])
})

test('gh errors are classified rather than collapsed into "no log"', () => {
  assert.equal(classifyGhError({ stderr: 'gh: Resource not accessible (HTTP 403)' }), 'FORBIDDEN')
  assert.equal(classifyGhError({ stderr: 'gh: Not Found (HTTP 404)' }), 'NOT_FOUND')
  assert.equal(classifyGhError({ stderr: 'gh: Gone (HTTP 410)' }), 'EXPIRED')
  assert.equal(classifyGhError({ stderr: 'gh: API rate limit exceeded (HTTP 429)' }), 'RATE_LIMITED')
  assert.equal(classifyGhError({ stderr: 'dial tcp: i/o timeout' }), 'DOWNLOAD_FAILED')
  assert.equal(classifyGhError({ stderr: 'something else entirely' }), 'DOWNLOAD_FAILED')
})

test('a log request for a bad id never reaches the network', () => {
  const seen = []
  const api = createGhApi(args => {
    seen.push(args.join(' '))
    return ''
  })
  assert.equal(api.jobLog(undefined).reason, 'MISSING_JOB_ID')
  assert.equal(api.jobLog(null).reason, 'MISSING_JOB_ID')
  assert.equal(api.jobLog('abc').reason, 'MALFORMED_JOB_ID')
  assert.equal(api.jobLog(-5).reason, 'MALFORMED_JOB_ID')
  assert.deepEqual(seen, [], 'no request may be made for an unusable id')
})

test('an empty log is reported as EMPTY, not as a successful read', () => {
  const api = createGhApi(() => '')
  const result = api.jobLog(42)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'EMPTY')
})

test('an oversized log keeps the tail, where the failure is', () => {
  const api = createGhApi(() => `${'noise '.repeat(200)}THE ACTUAL ERROR`, { maxLogBytes: 100 })
  const result = api.jobLog(42)
  assert.equal(result.ok, true)
  assert.match(result.text, /THE ACTUAL ERROR/)
  assert.equal(result.reason, 'TOO_LARGE')
})

test('an incomplete job list is flagged rather than silently short', () => {
  const api = createGhApi(() => JSON.stringify({ total_count: 250, jobs: [{ id: 1, name: 'a', conclusion: 'success' }] }))
  const listed = api.listJobs(1, { maxPages: 1 })
  assert.equal(listed.complete, false)
})

test('a non-JSON response is MALFORMED_RESPONSE, not an empty list', () => {
  const api = createGhApi(() => '<html>proxy error</html>')
  const listed = api.listJobs(1)
  assert.equal(listed.complete, false)
  assert.equal(listed.jobs.length, 0)
  assert.ok(listed.problems.some(problem => problem.reason === 'MALFORMED_RESPONSE'))
})

test('the run endpoint distinguishes an unreadable run from a null conclusion', () => {
  const failing = createGhApi(() => {
    throw Object.assign(new Error('boom'), { stderr: 'gh: Not Found (HTTP 404)' })
  })
  const result = failing.run(1)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NOT_FOUND')

  const good = createGhApi(() => JSON.stringify({ id: 1, conclusion: 'timed_out', status: 'completed' }))
  assert.equal(good.run(1).run.conclusion, 'timed_out')
})
