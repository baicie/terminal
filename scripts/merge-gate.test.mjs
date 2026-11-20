// The merge gate's rules, each pinned by a case that would have let the real failure
// through.
//
// ## Why these cases and not "does it return BLOCKED"
//
// A test that only checks one red path would pass for an implementation that blocks
// everything — which is useless, because it would push the next person to merge by
// hand and learn nothing. So each case below is the *specific* trap, and the
// may-merge cases are as important as the blocked ones.
//
// The two defects these encode actually happened:
//
//   * PR #128 and #129 merged with `Frontend quality` red (2026-11-20), leaving `main`
//     unable to pass its own bundle gate. That is `failing checks block`;
//   * the first ruleset iteration made every docs-only PR permanently unmergeable by
//     requiring path-filtered jobs. That is `path-filtered absence is not a failure`.
import assert from 'node:assert/strict'
import test from 'node:test'

import { decideMerge, PATH_FILTERED_CHECKS } from './merge-gate.mjs'

/** A PR that has finished successfully, so each case varies exactly one thing. */
const openPr = {
  number: 1,
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  headRefOid: 'abc123',
}

const greenChecks = [
  { name: 'required', state: 'SUCCESS', bucket: 'pass' },
  { name: 'Frontend quality', state: 'SUCCESS', bucket: 'pass' },
  { name: 'Rust quality', state: 'SUCCESS', bucket: 'pass' },
]

test('a finished, green PR may merge', () => {
  const result = decideMerge({ pr: openPr, checks: greenChecks })
  assert.equal(result.verdict, 'MAY_MERGE')
  assert.deepEqual(result.problems, [])
})

test('a failing check blocks, and the failing name is in the message', () => {
  // Exactly PR #129's state: the bundle gate red, everything else green.
  const result = decideMerge({
    pr: openPr,
    checks: [
      ...greenChecks.slice(1),
      { name: 'Frontend quality', state: 'FAILURE', bucket: 'fail' },
    ],
  })
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.problems.join('\n'), /Frontend quality/)
})

test('a pending check blocks instead of passing', () => {
  /*
   * The trap: `required` has not reported yet. Treating "no failure" as "pass" is how
   * a gate silently becomes decorative — the merge happens while the answer is still
   * being computed.
   */
  const result = decideMerge({
    pr: openPr,
    checks: [
      ...greenChecks,
      { name: 'Rust quality', state: 'IN_PROGRESS', bucket: 'pending' },
    ],
  })
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.problems.join('\n'), /still running/)
  assert.equal(result.counts.pending, 1)
})

test('a cancelled check is not a passed one', () => {
  /*
   * GitHub buckets a cancelled check as `fail`, so it would already block — but the
   * *reason* matters: a cancelled run means the job never finished, which is different
   * from "the tests failed". The message has to say which one happened, or the reader
   * re-runs CI to find out.
   */
  const result = decideMerge({
    pr: openPr,
    checks: [
      ...greenChecks,
      { name: 'Tauri build (windows-latest)', state: 'CANCELLED', bucket: 'fail' },
    ],
  })
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.problems.join('\n'), /cancelled/)
  // It must not also be reported as an ordinary failure — that double-counts.
  assert.equal(result.counts.cancelled, 1)
  assert.doesNotMatch(result.problems.join('\n'), /check\(s\) failed/)
})

test('a docs-only PR with no GUI checks may merge', () => {
  /*
   * The first ruleset iteration's P0: `native-gui-e2e.yml` is `paths:`-filtered, so a
   * docs-only PR produces no GUI run at all. Requiring those names left every such PR
   * permanently pending (`docs/ci/main-ruleset.md §4.1`). Their absence is legitimate.
   */
  const result = decideMerge({ pr: openPr, checks: greenChecks })
  assert.equal(result.verdict, 'MAY_MERGE')
})

test('a skipped path-filtered job is legitimate, but a skipped required one is not', () => {
  const filteredOnly = decideMerge({
    pr: openPr,
    checks: [
      ...greenChecks,
      { name: PATH_FILTERED_CHECKS[0], state: 'SKIPPED', bucket: 'skipping' },
    ],
  })
  assert.equal(filteredOnly.verdict, 'MAY_MERGE', 'a path-filtered skip is not a failure')

  const unexpected = decideMerge({
    pr: openPr,
    checks: [
      { name: 'required', state: 'SUCCESS', bucket: 'pass' },
      { name: 'Rust quality', state: 'SKIPPED', bucket: 'skipping' },
    ],
  })
  assert.equal(unexpected.verdict, 'BLOCKED')
  assert.match(unexpected.problems.join('\n'), /skipped unexpectedly/)
})

test('a head with no checks at all is not verified', () => {
  // "Nothing failed" is not "everything passed": CI may never have started.
  const result = decideMerge({ pr: openPr, checks: [] })
  assert.equal(result.verdict, 'BLOCKED')
  assert.match(result.problems.join('\n'), /no checks reported/)
})

test('a draft, a closed PR and a conflict each block', () => {
  assert.equal(decideMerge({ pr: { ...openPr, isDraft: true }, checks: greenChecks }).verdict, 'BLOCKED')
  assert.equal(decideMerge({ pr: { ...openPr, state: 'MERGED' }, checks: greenChecks }).verdict, 'BLOCKED')
  assert.equal(
    decideMerge({ pr: { ...openPr, mergeable: 'CONFLICTING' }, checks: greenChecks }).verdict,
    'BLOCKED',
  )
})

test('the verdict carries the head it graded', () => {
  /*
   * Trap 1, made checkable: the report names the SHA. A reader comparing it to the
   * browser tab is the only defence against grading the wrong commit, so the field has
   * to be present and be the PR's own value.
   */
  const result = decideMerge({ pr: { ...openPr, headRefOid: 'deadbeef' }, checks: greenChecks })
  assert.equal(result.headSha, 'deadbeef')
})
