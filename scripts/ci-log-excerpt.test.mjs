// T02 — the excerpt extractor, tested against the shape of a REAL log.
//
// The bug this pins: the first version took the earliest `##[error]` anchor and
// returned everything after it. A real GitHub job log ends with
// `##[error]Process completed with exit code 1.` five lines before EOF, so the
// excerpt was the cleanup tail and the compiler error 40 lines earlier was cut off.
// Measured on job 132820499497: `UNKNOWN` in the report, `error[E0433]` in the log.
import assert from 'node:assert/strict'
import test from 'node:test'

import { extractFailureExcerpt } from './attribute-ci-failure.mjs'

/** A log shaped like a real one: long preamble, the error, then runner cleanup. */
function realShapedLog({ errorLine, padding = 60 }) {
  const lines = []
  for (let i = 0; i < padding; i += 1) lines.push(`2026-11-15T13:06:04.0000000Z \u001b[92m   Compiling\u001b[0m crate${i} v1.0.0`)
  lines.push(`2026-11-15T13:10:37.4079954Z \u001b[1m\u001b[91m${errorLine}\u001b[0m`)
  for (let i = 0; i < padding; i += 1) lines.push(`2026-11-15T13:10:52.0000000Z \u001b[93mwarning\u001b[0m note ${i}`)
  // The runner's own error marker, right before EOF — the anchor the old code chose.
  lines.push('2026-11-15T13:10:53.1770894Z ##[error]Process completed with exit code 1.')
  lines.push('2026-11-15T13:10:55.0000000Z Post job cleanup.')
  lines.push('2026-11-15T13:10:55.1000000Z [command]/usr/bin/git version')
  lines.push('2026-11-15T13:10:55.2000000Z Cleaning up orphan processes')
  return lines.join('\n')
}

test('the compiler error survives even when ##[error] is at the end', () => {
  // This is the exact measured failure.
  const log = realShapedLog({ errorLine: 'error[E0433]: cannot find `unix` in `os`' })
  const excerpt = extractFailureExcerpt(log)
  assert.match(excerpt, /error\[E0433\]/)
})

test('a plain `error:` without an E-code also survives', () => {
  const log = realShapedLog({ errorLine: 'error: could not compile `terminal` (lib test) due to 2 errors' })
  const excerpt = extractFailureExcerpt(log)
  assert.match(excerpt, /could not compile/)
})

test('ANSI colour codes do not defeat the anchor', () => {
  const log = realShapedLog({ errorLine: 'error[E0599]: no method named `from_bytes`' })
  assert.match(extractFailureExcerpt(log), /E0599/)
})

test('a test failure marker is anchored too', () => {
  const log = [
    'noise 1',
    'noise 2',
    'test result: FAILED. 433 passed; 1 failed',
    'noise 3',
    '##[error]Process completed with exit code 1.',
  ].join('\n')
  assert.match(extractFailureExcerpt(log), /test result: FAILED/)
})

test('a panic line is anchored', () => {
  const log = ['setup', 'thread "main" panicked at src/main.rs:1:1', 'more setup', '##[error]exit 1'].join('\n')
  assert.match(extractFailureExcerpt(log), /panicked at/)
})

test('a log with no markers falls back to the tail rather than nothing', () => {
  const log = `start\n${'noise\n'.repeat(50)}the only clue`
  const excerpt = extractFailureExcerpt(log)
  assert.match(excerpt, /the only clue/)
})

test('an empty log yields an empty excerpt rather than an exception', () => {
  assert.equal(extractFailureExcerpt(''), '')
  assert.equal(extractFailureExcerpt(null), '')
  assert.equal(extractFailureExcerpt(undefined), '')
})

test('the excerpt respects the size cap', () => {
  const log = realShapedLog({ errorLine: 'error[E0433]: x', padding: 5000 })
  assert.ok(extractFailureExcerpt(log, { maxChars: 2000 }).length <= 2000)
})

test('the failing step name is used as an anchor when the runner prints no error', () => {
  const log = [
    '##[group]Run node scripts/run-gui-e2e.mjs',
    'starting the app',
    'GUI_E2E: webview never became ready',
    '##[endgroup]',
    '##[error]Process completed with exit code 1.',
  ].join('\n')
  const excerpt = extractFailureExcerpt(log, { stepNames: ['node scripts/run-gui-e2e.mjs'] })
  assert.match(excerpt, /webview never became ready/)
})
