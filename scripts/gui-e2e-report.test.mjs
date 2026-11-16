// The GUI layer report: per-run counts, never a history-wide sum, never a stale verdict.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildGuiReport, summariseGuiArtifacts } from './gui-e2e-report.mjs'

function artifacts(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gui-report-'))
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(root, name)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents))
  }
  return root
}

function wdio(passed, failed, skipped = 0) {
  return { state: { passed, failed, skipped } }
}

test('a clean run sums to PASS', () => {
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(6, 0),
    'json/wdio-0-1-1000000000060.json': wdio(3, 0),
    'run-summary.json': { verdict: 'PASS', exitCode: 0 },
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'Linux' })
  assert.equal(report.status, 'PASS')
  assert.equal(report.total, 9)
  assert.equal(report.failed, 0)
})

test('a failing case makes the layer FAIL even when the summary says PASS', () => {
  // The measured conflict: a stale summary claiming PASS over a window with failures.
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(2, 3),
    'run-summary.json': { verdict: 'PASS', exitCode: 0, ranAt: '2026-01-01T00:00:00Z' },
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'Windows' })
  assert.equal(report.status, 'FAIL')
  assert.equal(report.failed, 3)
  assert.ok(report.verdictConflict, 'the disagreement must be surfaced, not resolved silently')
  assert.match(report.verdictConflict, /predates this window/)
})

test('older runs are excluded, so the count describes one run', () => {
  // The committed artifacts hold 134 files across many runs. Summing all of them gave
  // 590 cases / 63 failures, which describes no run that ever happened.
  const root = artifacts({
    // 3 hours earlier: outside the one-hour window that groups a single invocation.
    'json/wdio-0-0-1000000000000.json': wdio(50, 50),
    'json/wdio-0-0-1000010800000.json': wdio(4, 0),
    'json/wdio-0-1-1000010800060.json': wdio(2, 0),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'macOS' })
  assert.equal(report.total, 6, 'the newer window only')
  assert.equal(report.failed, 0)
  assert.equal(report.runWindow.excludedOlderFiles, 1)
})

test('no wdio output at all is NOT_RUN, never a clean zero', () => {
  const root = artifacts({ 'run-summary.json': { verdict: 'FAIL', exitCode: 1 } })
  const report = buildGuiReport({ artifactsDir: root })
  assert.equal(report.status, 'NOT_RUN')
  assert.equal(report.notRun, 1)
  assert.match(report.reason, /no wdio output/)
})

test('one unreadable spec file makes the layer INCOMPLETE, not NOT_RUN', () => {
  // A 0-byte `wdio-*.json` is what a crashed spec leaves behind. The first version
  // returned NOT_RUN for the whole layer, discarding the readable specs beside it.
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'json/wdio-0-1-1000000000060.json': '',
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'macOS' })
  assert.equal(report.status, 'INCOMPLETE')
  assert.equal(report.total, 5, 'the readable counts are still reported')
  assert.equal(report.corruptFiles.length, 1)
  assert.match(report.reason, /unreadable/)
})

test('every file unreadable is NOT_RUN with the reason naming that', () => {
  const root = artifacts({ 'json/wdio-0-0-1000000000000.json': '' })
  const report = buildGuiReport({ artifactsDir: root })
  assert.equal(report.status, 'NOT_RUN')
  assert.match(report.reason, /every wdio file was unreadable/)
})

test('a truncated-but-parseable state block is summed, and missing fields are zero', () => {
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': { state: { passed: 2 } },
    'json/wdio-0-1-1000000000060.json': wdio(1, 0, 4),
  })
  const report = buildGuiReport({ artifactsDir: root })
  assert.equal(report.passed, 3)
  assert.equal(report.skipped, 4)
  assert.equal(report.total, 7)
  assert.equal(report.status, 'PASS')
})

test('files without a timestamp are treated as one run rather than excluded', () => {
  // A hand-written fixture (or an older wdio naming scheme) must not vanish.
  const root = artifacts({
    'json/wdio-0-0-darwin.json': wdio(3, 0),
  })
  const report = buildGuiReport({ artifactsDir: root })
  assert.equal(report.total, 3)
  assert.equal(report.runWindow, null, 'no window means no exclusion was applied')
})

test('summariseGuiArtifacts reports how many files it excluded', () => {
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(1, 0),
    'json/wdio-0-0-1000009000000.json': wdio(1, 0),
  })
  const counts = summariseGuiArtifacts(root)
  assert.equal(counts.specs, 1)
  assert.equal(counts.excluded, 1)
})
