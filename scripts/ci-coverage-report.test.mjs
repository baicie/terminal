// T17 — the coverage report's one job: never let an unrun layer look passed.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LAYERS,
  buildReport,
  layerEntry,
  notRunEntry,
  renderCoverage,
} from './ci-coverage-report.mjs'

test('every layer id in the module is unique', () => {
  const ids = LAYERS.map(layer => layer.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('a layer that did not run reports zero and a reason, not a percentage', () => {
  const gui = notRunEntry('gui-e2e', 'no macOS runner in this job')
  assert.equal(gui.total, 0)
  assert.equal(gui.notRun, 'no macOS runner in this job')
})

test('the pass rate excludes layers that did not run', () => {
  // The failure this prevents: a week with no GUI runs must not look like a week with
  // no GUI failures.
  const report = buildReport([
    layerEntry('unit-frontend', { total: 100, passed: 100 }),
    notRunEntry('gui-e2e', 'no WebView on this runner'),
  ])
  assert.equal(report.ranLayers, 1)
  assert.equal(report.notRunLayers, 1)
  assert.equal(report.passRate, 1)
})

test('nothing having run yields a null rate, not 0%', () => {
  const report = buildReport([notRunEntry('gui-e2e', 'skipped whole job')])
  assert.equal(report.passRate, null)
  assert.match(renderCoverage(report), /not computed/)
})

test('a failing layer lowers the rate and is counted', () => {
  const report = buildReport([
    layerEntry('unit-frontend', { total: 10, passed: 8, failed: 2 }),
  ])
  assert.equal(report.failed, 2)
  assert.equal(report.passRate, 0.8)
})

test('skipped counts against the denominator but not against passed', () => {
  // A skipped case is neither a pass nor a failure; it must not inflate the rate.
  const report = buildReport([
    layerEntry('unit-rust', { total: 10, passed: 6, failed: 1, skipped: 3 }),
  ])
  assert.equal(report.passed, 6)
  assert.equal(report.failed, 1)
  assert.equal(report.skipped, 3)
  assert.equal(report.passRate, 0.6)
})

test('a layer whose counts exceed its total is rejected', () => {
  // Catches a parser that double-counts, which is how a report exaggerates coverage.
  assert.throws(
    () => layerEntry('unit-frontend', { total: 5, passed: 4, failed: 3 }),
    /exceeds total/,
  )
})

test('an unknown layer id is rejected rather than invented', () => {
  assert.throws(() => layerEntry('made-up', { total: 1, passed: 1 }), /unknown layer/)
})

test('the rendered table names every layer including the ones that did not run', () => {
  const report = buildReport([
    layerEntry('unit-rust', { total: 434, passed: 434, platform: 'macOS' }),
    notRunEntry('real-machine', 'weekly schedule only', { platform: 'macOS' }),
  ])
  const text = renderCoverage(report)
  assert.match(text, /Unit — Rust \(cargo test --lib\)/)
  assert.match(text, /Real machine — SSH\/PTY matrix/)
  assert.match(text, /weekly schedule only/)
  // And it states how many layers were excluded, so a reader cannot mistake the rate
  // for whole-suite coverage.
  assert.match(text, /1 layer\(s\) did not run and are excluded/)
})

test('a fully green run reads as 100%', () => {
  const report = buildReport([
    layerEntry('unit-rust', { total: 10, passed: 10 }),
    layerEntry('scripts', { total: 5, passed: 5 }),
  ])
  assert.equal(report.passRate, 1)
  assert.match(renderCoverage(report), /100\.0%/)
})
