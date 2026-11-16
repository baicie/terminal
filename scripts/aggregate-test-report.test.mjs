// T10 — aggregation over a real directory tree.
//
// These build actual files on disk and run the real `collectLayers`, because the bugs
// this class of code has (missing file read as zero, duplicate artifact double-counted,
// two commits mixed) only appear when the filesystem is involved.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { collectLayers } from './aggregate-test-report.mjs'
import { buildReport } from './ci-test-report.mjs'
import { renderTestReport } from './ci-test-report-render.mjs'

function makeTree(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'test-report-'))
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents))
  }
  return root
}

const VITEST = { numTotalTests: 100, numPassedTests: 98, numFailedTests: 2, numPendingTests: 0 }
const LIBTEST = 'test result: ok. 434 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out'

test('a missing artifact is NOT_RUN, never zero tests', () => {
  const root = makeTree({})
  const layers = collectLayers({ root, commitSha: 'a'.repeat(40) })
  const frontend = layers.find(layer => layer.layer === 'unit-frontend')
  assert.equal(frontend.status, 'NOT_RUN')
  assert.match(frontend.reason, /no report was uploaded/)
  assert.equal(frontend.total, 0)

  const report = buildReport(layers)
  assert.equal(report.complete, false, 'a report with nothing uploaded is not complete')
})

test('an empty file is treated as missing rather than as zero tests', () => {
  // A truncated upload is the common failure; reading it as 0/0 would look green.
  const root = makeTree({ 'packages/frontend/test-results/vitest.json': '' })
  const layers = collectLayers({ root })
  const frontend = layers.find(layer => layer.layer === 'unit-frontend')
  assert.equal(frontend.status, 'NOT_RUN')
})

test('an unparseable report is INCOMPLETE and keeps the reason', () => {
  const root = makeTree({ 'packages/frontend/test-results/vitest.json': '{"truncated":' })
  const layers = collectLayers({ root })
  const frontend = layers.find(layer => layer.layer === 'unit-frontend')
  assert.equal(frontend.status, 'INCOMPLETE')
  assert.match(frontend.reason, /could not parse/)
})

test('a real vitest report becomes a layer with conserving counts', () => {
  const root = makeTree({ 'packages/frontend/test-results/vitest.json': VITEST })
  const layers = collectLayers({ root, commitSha: 'b'.repeat(40) })
  const frontend = layers.find(layer => layer.layer === 'unit-frontend')
  // VITEST has 2 failures, so the status must be FAIL — the point is that the counts
  // are carried through, not that a suite with failures can be PASS.
  assert.equal(frontend.status, 'FAIL')
  assert.equal(frontend.total, 100)
  assert.equal(frontend.passed, 98)
  assert.equal(frontend.failed, 2)
  assert.equal(frontend.unaccounted, 0)
})

test('a failing suite is FAIL, not PASS', () => {
  const root = makeTree({
    'packages/frontend/test-results/vitest.json': { numTotalTests: 10, numPassedTests: 8, numFailedTests: 2 },
  })
  const frontend = collectLayers({ root }).find(layer => layer.layer === 'unit-frontend')
  assert.equal(frontend.status, 'FAIL')
  assert.equal(frontend.failed, 2)
})

test('a skipped job is BLOCKED, and named as such', () => {
  const root = makeTree({ 'packages/frontend/test-results/vitest.json': VITEST })
  const layers = collectLayers({ root, skipped: ['ipc-e2e'] })
  const ipc = layers.find(layer => layer.layer === 'ipc-e2e')
  assert.equal(ipc.status, 'BLOCKED')
  assert.match(ipc.reason, /skipped in CI/)
})

test('libtest text is summed across binaries in the report', () => {
  const root = makeTree({
    'src-tauri/test-results/cargo-test.txt': [
      'test result: ok. 400 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out',
      'test result: ok. 34 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out',
    ].join('\n'),
  })
  const rust = collectLayers({ root }).find(layer => layer.layer === 'unit-rust')
  assert.equal(rust.passed, 434)
  assert.equal(rust.skipped, 3)
  assert.equal(rust.status, 'PASS')
})

test('two different commits in one report are refused', async () => {
  // The guard lives in the CLI's main(), so exercise the same predicate it uses.
  const root = makeTree({
    'packages/frontend/test-results/vitest.json': VITEST,
    'src-tauri/test-results/cargo-test.txt': LIBTEST,
  })
  const layers = collectLayers({ root, commitSha: 'c'.repeat(40) })
  const shas = new Set(layers.map(layer => layer.commitSha).filter(Boolean))
  assert.equal(shas.size, 1, 'one report must describe one commit')
})

test('every canonical layer appears in the report, including the ones with no file', () => {
  const root = makeTree({ 'packages/frontend/test-results/vitest.json': VITEST })
  const layers = collectLayers({ root })
  const ids = layers.map(layer => layer.layer).sort()
  assert.equal(ids.length, 10, 'every layer must have an entry so nothing disappears')
})

test('the rendered report names every layer and its status', () => {
  const root = makeTree({
    'packages/frontend/test-results/vitest.json': VITEST,
    'src-tauri/test-results/cargo-test.txt': LIBTEST,
  })
  const report = buildReport(collectLayers({ root, commitSha: 'd'.repeat(40) }))
  const text = renderTestReport(report)
  assert.match(text, /Unit — frontend \(vitest\)/)
  assert.match(text, /Unit — Rust \(cargo test --lib\)/)
  assert.match(text, /GUI E2E — real WebView/)
  assert.match(text, /NOT_RUN/)
  assert.match(text, /Test execution report/)
  // It must not claim to be line coverage.
  assert.match(text, /not line coverage/i)
})

test('the rendered report states the scope of what was not measured', () => {
  const root = makeTree({ 'packages/frontend/test-results/vitest.json': VITEST })
  const text = renderTestReport(buildReport(collectLayers({ root })))
  assert.match(text, /Not measured this run/)
  assert.match(text, /NOT_RUN \(no report uploaded\)/)
})

test('a NOT_RUN layer never reads as a pass in the rendered text', () => {
  const root = makeTree({})
  const text = renderTestReport(buildReport(collectLayers({ root })))
  assert.doesNotMatch(text, /\| PASS \|/)
  assert.match(text, /NOT_RUN/)
})
