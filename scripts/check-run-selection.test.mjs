// T12 — the release gate's fact collector.
//
// Every case here is a way the previous implementation could have passed a release
// it should have blocked. The old code took the *last* entry per check name from one
// 100-item page and compared `conclusion` only.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  selectAcrossPages,
  selectCheckRuns,
  summarizeForRelease,
} from './check-run-selection.mjs'

const COMMIT = 'a'.repeat(40)
const APP = 15368

/** One check run, with the fields the API actually returns. */
function run(id, name, { status = 'completed', conclusion = 'success', sha = COMMIT, app = APP } = {}) {
  return { id, name, status, conclusion, head_sha: sha, app: { id: app } }
}

test('a re-run replaces the earlier result by id, not by array order', () => {
  // The failure: the old code took whichever entry came last in the array. GitHub
  // documents no ordering, so a failure followed by an older success in the response
  // would have won.
  const { checks } = selectCheckRuns([
    run(200, 'Rust quality', { conclusion: 'success' }),
    run(100, 'Rust quality', { conclusion: 'failure' }),
  ])
  assert.equal(checks['Rust quality'].id, 200)
  assert.equal(checks['Rust quality'].conclusion, 'success')
})

test('a newer failure is not overwritten by an older success', () => {
  const { checks } = selectCheckRuns([
    run(100, 'Rust quality', { conclusion: 'success' }),
    run(200, 'Rust quality', { conclusion: 'failure' }),
  ])
  assert.equal(checks['Rust quality'].conclusion, 'failure')
})

test('a pending re-run supersedes an earlier success', () => {
  // Correct behaviour and easy to get wrong: "still running" is the newest statement
  // about the check, and a release must wait rather than read the older success.
  const { checks } = selectCheckRuns([
    run(100, 'Rust quality', { conclusion: 'success' }),
    run(200, 'Rust quality', { status: 'in_progress', conclusion: null }),
  ])
  assert.equal(checks['Rust quality'].status, 'in_progress')
  assert.equal(checks['Rust quality'].conclusion, null)

  const problems = summarizeForRelease(checks, ['Rust quality'], COMMIT)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].code, 'check-incomplete')
})

test('a run from an untrusted app cannot satisfy a required check', () => {
  // Same name, different App: a fork or an unrelated integration can publish it.
  const { checks, ignored } = selectCheckRuns(
    [
      run(100, 'Rust quality', { conclusion: 'success', app: 99999 }),
      run(50, 'Rust quality', { conclusion: 'failure', app: APP }),
    ],
    { allowedAppIds: new Set([APP]) },
  )
  assert.equal(checks['Rust quality'].id, 50, 'the untrusted run must not win')
  assert.equal(ignored.length, 1)
  assert.match(ignored[0].reason, /not trusted/)
})

test('an untrusted run does not silently become the only entry', () => {
  const { checks } = selectCheckRuns([run(100, 'Rust quality', { app: 99999 })], {
    allowedAppIds: new Set([APP]),
  })
  assert.equal(checks['Rust quality'], undefined)
  // And a missing check is a failure, not a pass.
  assert.equal(summarizeForRelease(checks, ['Rust quality'], COMMIT)[0].code, 'check-missing')
})

test('pagination is merged before selection, not decided per page', () => {
  // Page 2 can contain an *older* run of the same name. Selecting per page and then
  // taking "page 1 wins" would be wrong; concatenating first is what makes the id
  // rule apply across the whole response.
  const pages = [
    [run(100, 'Rust quality', { conclusion: 'failure' })],
    [run(200, 'Rust quality', { conclusion: 'success' })],
  ]
  assert.equal(selectAcrossPages(pages, {}).checks['Rust quality'].conclusion, 'success')

  const reversed = [
    [run(200, 'Rust quality', { conclusion: 'success' })],
    [run(100, 'Rust quality', { conclusion: 'failure' })],
  ]
  assert.equal(
    selectAcrossPages(reversed, {}).checks['Rust quality'].conclusion,
    'success',
    'page order must not change the answer',
  )
})

test('a malformed run is ignored rather than guessed at', () => {
  const { checks, ignored } = selectCheckRuns([
    { name: 'Rust quality' }, // no id
    { id: 5 }, // no name
    run(100, 'Frontend quality'),
  ])
  assert.equal(ignored.length, 2)
  assert.deepEqual(Object.keys(checks), ['Frontend quality'])
})

test('a non-array response yields no checks instead of throwing', () => {
  // An error body from the API is not a check list. Failing closed means the release
  // sees "missing", not an exception that a `catch` might swallow.
  for (const bad of [null, undefined, {}, 'oops', 42]) {
    const { checks } = selectCheckRuns(bad)
    assert.deepEqual(checks, {})
  }
})

test('a check that ran on a different commit is reported', () => {
  const { checks } = selectCheckRuns([run(100, 'Rust quality', { sha: 'b'.repeat(40) })])
  const problems = summarizeForRelease(checks, ['Rust quality'], COMMIT)
  assert.equal(problems[0].code, 'check-wrong-sha')
})

test('every conclusion other than success is a failure', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'neutral', 'skipped', null]) {
    const { checks } = selectCheckRuns([run(100, 'Rust quality', { conclusion })])
    const problems = summarizeForRelease(checks, ['Rust quality'], COMMIT)
    assert.equal(problems.length, 1, `conclusion ${JSON.stringify(conclusion)} must fail`)
    assert.ok(
      ['check-not-success', 'check-incomplete'].includes(problems[0].code),
      problems[0].code,
    )
  }
})

test('a successful release has no problems', () => {
  const { checks } = selectCheckRuns([
    run(1, 'Rust quality'),
    run(2, 'Frontend quality'),
    run(3, 'required'),
  ])
  assert.deepEqual(summarizeForRelease(checks, ['Rust quality', 'Frontend quality', 'required'], COMMIT), [])
})

test('a missing name among several is reported by name', () => {
  const { checks } = selectCheckRuns([run(1, 'Rust quality')])
  const problems = summarizeForRelease(checks, ['Rust quality', 'required'], COMMIT)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].name, 'required')
  assert.equal(problems[0].code, 'check-missing')
})
