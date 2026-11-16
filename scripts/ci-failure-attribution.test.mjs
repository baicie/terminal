// T24 — what a failure means, and the rule that a new one is never "known".
import assert from 'node:assert/strict'
import test from 'node:test'

import { FAILURE_CATEGORIES, classifyFailure, classifyRun } from './ci-failure-attribution.mjs'
import { renderReport } from './ci-failure-report.mjs'

test('stale evidence is not a code failure', () => {
  // The dominant failure in this repository's history. It reads like a gate failure
  // and is really "the acceptance run predates this commit".
  const result = classifyFailure({
    jobName: 'Repository gates (source size, evidence, script tests)',
    logText:
      '2026-10-11-macos-cold-start-current.json was recorded against source fingerprint d45be813, but the terminal sources now fingerprint as 195672e8.',
  })
  assert.equal(result.category, 'EVIDENCE_STALE')
  assert.equal(result.blocking, false)
})

test('an unclassified failure is UNKNOWN and blocking', () => {
  // The rule that matters: nothing is quietly filed under KNOWN_ISSUE.
  const result = classifyFailure({ jobName: 'Something new', logText: 'mysterious output' })
  assert.equal(result.category, 'UNKNOWN')
  assert.equal(result.blocking, true)
})

test('a compiler error is a product regression, not a test regression', () => {
  const result = classifyFailure({
    jobName: 'Rust quality',
    logText: 'error[E0433]: cannot find `unix` in `os`',
  })
  assert.equal(result.category, 'PRODUCT_REGRESSION')
})

test('a failed assertion is a test regression', () => {
  const result = classifyFailure({
    jobName: 'Rust quality',
    logText: 'test result: FAILED. 433 passed; 1 failed',
  })
  assert.equal(result.category, 'TEST_REGRESSION')
})

test('a network failure is infrastructure', () => {
  for (const line of [
    'SSL_ERROR_SYSCALL while downloading moxcms',
    'received 502 Bad Gateway from tauri-apps/binary-releases',
    'ECONNRESET',
  ]) {
    assert.equal(
      classifyFailure({ jobName: 'Tauri build (ubuntu-latest)', logText: line }).category,
      'INFRA_FAILURE',
      line,
    )
  }
})

test('a new advisory is a security finding', () => {
  const result = classifyFailure({
    jobName: 'cargo audit (blocking)',
    logText: 'RUSTSEC-2026-0486: rustix xattr zero-length buffer is unsound',
  })
  assert.equal(result.category, 'SECURITY_FINDING')
})

test('a release gate refusal is RELEASE_BLOCKED', () => {
  const result = classifyFailure({
    jobName: 'Release qualification',
    logText: '[check-wrong-sha] required check "Rust quality" last ran on bbbb, which is not the release commit aaaa',
  })
  assert.equal(result.category, 'RELEASE_BLOCKED')
})

test('KNOWN_ISSUE requires a reference, not the word "known"', () => {
  // A bare "known problem" in a log is not a classification; it has to point at the
  // issue that tracks it, or it is just an unexplained failure.
  assert.equal(
    classifyFailure({ jobName: 'x', logText: 'a known problem with the renderer' }).category,
    'UNKNOWN',
  )
  assert.equal(
    classifyFailure({ jobName: 'x', logText: 'known issue: docs/issue.md#144' }).category,
    'KNOWN_ISSUE',
  )
})

test('evidence staleness does not shadow a fingerprint bug', () => {
  // The signature is the gate's sentence, not the word "fingerprint": a bug in the
  // fingerprint *algorithm* must surface as a product problem, not be filed as stale.
  const result = classifyFailure({
    jobName: 'Repository gates',
    logText: 'TypeError: source.matchAll is not a function in computeSourceFingerprint',
  })
  assert.notEqual(result.category, 'EVIDENCE_STALE')
})

test('an informational job never blocks, whatever it is', () => {
  const result = classifyFailure({
    jobName: 'Windows GUI E2E (informational)',
    logText: 'error[E0433]: cannot find unix in os',
    informational: true,
  })
  assert.equal(result.category, 'PRODUCT_REGRESSION')
  assert.equal(result.blocking, false, 'informational must never block')
})

test('a cancelled run is infrastructure, not a product verdict', () => {
  const result = classifyRun({ conclusion: 'cancelled' })
  assert.equal(result.category, 'INFRA_FAILURE')
  assert.equal(result.blocking, false)
})

test('a run with one blocking failure among flakes reports the blocking one', () => {
  const result = classifyRun({
    conclusion: 'failure',
    jobs: [
      { name: 'Tauri build (ubuntu-latest)', conclusion: 'failure', logText: 'SSL_ERROR_SYSCALL' },
      { name: 'Rust quality', conclusion: 'failure', logText: 'error[E0433]: cannot find unix' },
    ],
  })
  assert.equal(result.category, 'PRODUCT_REGRESSION')
  assert.equal(result.blocking, true)
  assert.equal(result.jobs.length, 2)
})

test('a run whose only failures are informational does not block', () => {
  const result = classifyRun({
    conclusion: 'failure',
    jobs: [
      {
        name: 'Windows GUI E2E (informational)',
        conclusion: 'failure',
        logText: '✖ mounts exactly one terminal workbench',
        informational: true,
      },
    ],
  })
  assert.equal(result.blocking, false)
})

test('a clean run reports nothing failed', () => {
  // `jobCount` matters now: `success` with an empty job list is not proof of a clean
  // run, because the jobs endpoint always returns the run's own jobs. The old version
  // of this test pinned `success` + `[]` as clean, which is the assertion that let a
  // truncated job list read as a pass.
  const result = classifyRun({
    conclusion: 'success',
    jobs: [{ name: 'Rust quality', conclusion: 'success' }],
  })
  assert.equal(result.category, null)
  assert.equal(result.detail, 'clean')

  const truncated = classifyRun({ conclusion: 'success', jobs: [] })
  assert.notEqual(truncated.detail, 'clean')
  assert.equal(truncated.category, 'UNKNOWN')
})

test('every category has an action, and only three are non-blocking', () => {
  const nonBlocking = Object.entries(FAILURE_CATEGORIES)
    .filter(([, meta]) => !meta.blocking)
    .map(([name]) => name)
    .sort()
  assert.deepEqual(nonBlocking, ['EVIDENCE_STALE', 'INFRA_FAILURE', 'KNOWN_ISSUE'])
  for (const [name, meta] of Object.entries(FAILURE_CATEGORIES)) {
    assert.ok(meta.action.length > 0, `${name} needs an action`)
  }
})

test('the rendered report names the category and the action', () => {
  const result = classifyRun({
    conclusion: 'failure',
    jobs: [{ name: 'Rust quality', conclusion: 'failure', logText: 'error[E0433]' }],
  })
  const text = renderReport(result)
  assert.match(text, /PRODUCT_REGRESSION/)
  assert.match(text, /fix the product/)
  assert.match(text, /\| Rust quality \|/)
})

test('both evidence sentences are recognised (measured on a real log)', () => {
  // The two come from different checks and I only matched one at first:
  //
  //   manifest:       "was produced from source fingerprint X, but these sources …"
  //   evidence file:  "was recorded against source fingerprint X, but the terminal …"
  //
  // A real log with the first form was classified UNKNOWN until the second pattern
  // was added, which is why this case exists.
  const manifest = classifyFailure({
    jobName: 'Repository gates (source size, evidence, script tests)',
    logText:
      'evidence-manifest.json was produced from source fingerprint d45be813, but these sources fingerprint as 195672e8.',
  })
  assert.equal(manifest.category, 'EVIDENCE_STALE')

  const perFile = classifyFailure({
    jobName: 'Repository gates (source size, evidence, script tests)',
    logText:
      '2026-10-11-macos-cold-start-current.json was recorded against source fingerprint d45be813, but the terminal sources now fingerprint as 195672e8.',
  })
  assert.equal(perFile.category, 'EVIDENCE_STALE')
})
