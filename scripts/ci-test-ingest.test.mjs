// T09 — parsers for the runners' own machine-readable output.
//
// The rule being enforced: no count may be derived from filenames, and a parser that
// cannot understand its input must throw rather than return zeros. Zeros are
// indistinguishable from "ran and found nothing wrong".
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INGESTION_PLAN,
  parseByKind,
  parseHarnessJson,
  parseLibtestText,
  parseTap,
  parseVitestJson,
} from './ci-test-ingest.mjs'
import { LAYERS } from './ci-test-report.mjs'

test('vitest JSON yields all four counts', () => {
  const counts = parseVitestJson(
    JSON.stringify({ numTotalTests: 2337, numPassedTests: 2330, numFailedTests: 5, numPendingTests: 2 }),
  )
  assert.deepEqual(
    { total: counts.total, passed: counts.passed, failed: counts.failed, skipped: counts.skipped },
    { total: 2337, passed: 2330, failed: 5, skipped: 2 },
  )
  assert.equal(counts.passed + counts.failed + counts.skipped, counts.total, 'must conserve')
})

test('vitest with only pending implied still conserves', () => {
  const counts = parseVitestJson({ numTotalTests: 10, numPassedTests: 7, numFailedTests: 1 })
  assert.equal(counts.skipped, 2)
  assert.equal(counts.passed + counts.failed + counts.skipped, counts.total)
})

test('a vitest report missing its counts is rejected, not zeroed', () => {
  assert.throws(() => parseVitestJson({ success: true }), /missing numTotalTests/)
})

test('libtest sums every test binary in the workspace', () => {
  // One line per binary. Taking only the last would drop all but one binary's tests.
  const text = [
    'running 400 tests',
    'test result: ok. 400 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out',
    'running 34 tests',
    'test result: FAILED. 33 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out',
    'running 0 tests',
    'test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out',
  ].join('\n')
  const counts = parseLibtestText(text)
  assert.equal(counts.binaries, 3)
  assert.deepEqual(
    { total: counts.total, passed: counts.passed, failed: counts.failed, skipped: counts.skipped },
    { total: 437, passed: 433, failed: 1, skipped: 3 },
  )
})

test('libtest with no result line is an error, not zero tests', () => {
  assert.throws(() => parseLibtestText('error: could not compile'), /no "test result:" line/)
  assert.throws(() => parseLibtestText(''), /no "test result:" line/)
})

test('TAP counts top-level tests and skips subtests', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: a parent',
    'ok 1 - a parent',
    '  ---',
    '  duration_ms: 1.2',
    '  ...',
    '# Subtest: second',
    'not ok 2 - second',
    '  ---',
    '  error: nope',
    '  ...',
    'ok 3 - third # SKIP not on this platform',
    '1..3',
    '# tests 3',
    '# pass 1',
    '# fail 1',
    '# skipped 1',
  ].join('\n')
  const counts = parseTap(tap)
  assert.deepEqual(
    { total: counts.total, passed: counts.passed, failed: counts.failed, skipped: counts.skipped },
    { total: 3, passed: 1, failed: 1, skipped: 1 },
  )
})

test('TAP with no test lines is an error', () => {
  assert.throws(() => parseTap('# nothing here'), /no TAP/)
})

test('a harness result.json with cases is counted by status', () => {
  const counts = parseHarnessJson({
    cases: [
      { name: 'upload', status: 'PASS' },
      { name: 'download', status: 'PASS' },
      { name: 'cancel', status: 'FAILED' },
      { name: 'resume', status: 'SKIPPED' },
    ],
  })
  assert.deepEqual(
    { total: counts.total, passed: counts.passed, failed: counts.failed, skipped: counts.skipped },
    { total: 4, passed: 2, failed: 1, skipped: 1 },
  )
})

test('a harness case with an unknown status is an error, not a pass', () => {
  assert.throws(
    () => parseHarnessJson({ cases: [{ name: 'x', status: 'WEIRD' }] }),
    /unrecognised status/,
  )
})

test('a harness summary object is accepted', () => {
  const counts = parseHarnessJson({ passed: 7, failed: 1, skipped: 2 })
  assert.equal(counts.total, 10)
})

test('an unrecognisable harness report is an error', () => {
  assert.throws(() => parseHarnessJson({ results: [] }), /neither a cases array/)
})

test('parseByKind dispatches and rejects unknown kinds', () => {
  assert.equal(parseByKind('harness', { passed: 1, failed: 0 }).total, 1)
  assert.throws(() => parseByKind('nope', {}), /unknown parser/)
})

test('the ingestion plan covers every canonical layer', () => {
  // A layer without an adapter silently becomes NOT_RUN forever.
  const planned = new Set(INGESTION_PLAN.map(entry => entry.layer))
  for (const layer of LAYERS) {
    assert.ok(planned.has(layer.id), `${layer.id} has no ingestion adapter`)
  }
  for (const entry of INGESTION_PLAN) {
    assert.ok(LAYERS.some(layer => layer.id === entry.layer), `${entry.layer} is not a canonical layer`)
    assert.ok(['vitest', 'libtest', 'tap', 'harness'].includes(entry.parser), entry.parser)
  }
})

test('the plan ids are unique', () => {
  const ids = INGESTION_PLAN.map(entry => entry.layer)
  assert.equal(new Set(ids).size, ids.length)
})
