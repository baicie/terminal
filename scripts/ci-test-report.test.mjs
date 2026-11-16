// T08 — the count contract. Every case here produced a wrong or undefined answer
// under the old `passRate = passed / (passed + failed + skipped)` with no validation.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LAYERS,
  LAYER_STATUSES,
  blockedEntry,
  buildReport,
  incompleteEntry,
  layerEntry,
  notRunEntry,
} from './ci-test-report.mjs'

test('unclassified tests cannot vanish into a 100% rate', () => {
  // The measured defect: total 100, only 50 accounted for, old rate was 1.0.
  const entry = layerEntry('unit-frontend', { total: 100, passed: 50 })
  assert.equal(entry.status, 'INCOMPLETE')
  assert.equal(entry.unaccounted, 50)

  const report = buildReport([entry])
  assert.equal(report.passRate, null, 'an incomplete layer must not yield a rate')
  assert.equal(report.complete, false)
  assert.equal(report.green, false)
})

test('the conservation rule holds exactly', () => {
  const ok = layerEntry('unit-rust', { total: 10, passed: 6, failed: 2, skipped: 1, notRun: 1 })
  assert.equal(ok.status, 'FAIL')
  assert.equal(ok.unaccounted, 0)
})

test('negative counts are rejected', () => {
  for (const counts of [
    { total: 10, passed: -1, failed: 11 },
    { total: -5, passed: -5 },
    { total: 10, passed: 10, failed: -0.5 },
  ]) {
    assert.throws(() => layerEntry('unit-frontend', counts), /non-negative integer/, JSON.stringify(counts))
  }
})

test('NaN and Infinity are rejected rather than propagated', () => {
  assert.throws(() => layerEntry('unit-frontend', { total: Number.NaN, passed: 1 }), /non-negative integer/)
  assert.throws(() => layerEntry('unit-frontend', { total: Number.POSITIVE_INFINITY, passed: 1 }), /non-negative integer/)
})

test('fractional counts are rejected', () => {
  assert.throws(() => layerEntry('unit-frontend', { total: 10.5, passed: 10.5 }), /non-negative integer/)
})

test('a layer that did not run is not a zero-failure layer', () => {
  const entry = notRunEntry('gui-e2e', 'no macOS runner in this job')
  assert.equal(entry.status, 'NOT_RUN')
  assert.equal(entry.total, 0)
  // Crucially: it is NOT reported as PASS.
  assert.notEqual(entry.status, 'PASS')
  const report = buildReport([entry])
  assert.equal(report.passRate, null)
  assert.equal(report.green, true, 'nothing failed, so the run is not red...')
  assert.equal(report.complete, false, '...but the report does not describe every layer')
})

test('an unparseable report is INCOMPLETE, not zero', () => {
  const entry = incompleteEntry('unit-frontend', 'could not parse vitest.json')
  assert.equal(entry.status, 'INCOMPLETE')
  // INCOMPLETE must not be mistakable for a layer that ran and found nothing: the
  // report as a whole must not be green, and no rate may be computed from it.
  const report = buildReport([entry])
  assert.equal(report.green, false)
  assert.equal(report.passRate, null)
})

test('a blocked layer is distinguished from one that never ran', () => {
  const blocked = blockedEntry('ipc-e2e', 'command E2E failed, so this was skipped')
  assert.equal(blocked.status, 'BLOCKED')
  assert.notEqual(blocked.status, 'NOT_RUN')
  const report = buildReport([blocked])
  assert.equal(report.green, false, 'a blocked layer means the verdict is unknown')
})

test('every status in the contract is producible', () => {
  const produced = new Set([
    layerEntry('unit-frontend', { total: 2, passed: 2 }).status,
    layerEntry('unit-frontend', { total: 2, passed: 1, failed: 1 }).status,
    layerEntry('unit-frontend', { total: 2, skipped: 2 }).status,
    notRunEntry('unit-frontend', 'x').status,
    incompleteEntry('unit-frontend', 'x').status,
    blockedEntry('unit-frontend', 'x').status,
  ])
  assert.deepEqual([...produced].sort(), [...LAYER_STATUSES].sort())
})

test('a fully green measurement is 100%', () => {
  const report = buildReport([
    layerEntry('unit-frontend', { total: 10, passed: 10 }),
    layerEntry('unit-rust', { total: 5, passed: 5 }),
  ])
  assert.equal(report.passRate, 1)
  assert.equal(report.green, true)
  assert.equal(report.complete, true)
})

test('a failed layer makes the report not green even at a high rate', () => {
  const report = buildReport([
    layerEntry('unit-frontend', { total: 99, passed: 99 }),
    layerEntry('unit-rust', { total: 1, passed: 0, failed: 1 }),
  ])
  assert.equal(report.green, false)
  assert.ok(report.passRate > 0.9, 'the rate can be high and the verdict still red')
})

test('the same layer twice is rejected rather than double-counted', () => {
  // A duplicated artifact would double every number.
  assert.throws(
    () =>
      buildReport([
        layerEntry('unit-rust', { total: 1, passed: 1 }),
        layerEntry('unit-rust', { total: 1, passed: 1 }),
      ]),
    /reported twice/,
  )
})

test('an unknown layer id is rejected', () => {
  assert.throws(() => layerEntry('made-up', { total: 0 }), /unknown layer/)
})

test('a layer with zero total is NOT_RUN rather than PASS', () => {
  const entry = layerEntry('unit-rust', { total: 0, passed: 0 })
  assert.equal(entry.status, 'NOT_RUN')
})

test('skipped-only is its own status, not a pass', () => {
  const entry = layerEntry('gui-e2e', { total: 4, skipped: 4 })
  assert.equal(entry.status, 'SKIPPED')
  assert.notEqual(entry.status, 'PASS')
})

test('every canonical layer has a stable id and a label', () => {
  const ids = LAYERS.map(layer => layer.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const layer of LAYERS) {
    assert.ok(layer.label.length > 0)
    assert.ok(['unit', 'e2e', 'gate'].includes(layer.kind))
  }
})
