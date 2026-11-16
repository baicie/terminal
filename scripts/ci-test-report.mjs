/**
 * The contract for one layer's test results.
 *
 * ## Why a contract instead of a count
 *
 * `renderCoverage` used to compute `passRate = passed / (passed + failed + skipped)`
 * from whatever numbers a caller supplied. That hides the failure it was written to
 * prevent: if `total` is 100 and only 50 cases were accounted for, the pass rate is
 * `50/50 = 100%` while 50 tests vanished. Measured on the old code:
 *
 *   layerEntry('unit-frontend', { total: 100, passed: 50 })  ->  passRate 1
 *
 * It also accepted negatives, `NaN`, `Infinity` and floats, so a broken parser could
 * produce a negative "pass" count.
 *
 * ## The conservation rule
 *
 * `passed + failed + skipped + notRun === total`, exactly. Where the numbers do not
 * add up, the layer's status is `INCOMPLETE` and no rate is computed at all.
 *
 * ## The statuses, and what each one means
 *
 * | status      | meaning |
 * | --- | --- |
 * | PASS        | ran, every case passed |
 * | FAIL        | ran, at least one case failed |
 * | SKIPPED     | ran, every case was skipped (e.g. platform filter) |
 * | NOT_RUN     | this layer did not execute in this run; `reason` says why |
 * | INCOMPLETE  | counts do not conserve, or the report could not be parsed |
 * | BLOCKED     | the layer could not run because a prerequisite failed |
 *
 * `NOT_RUN` and `INCOMPLETE` are different: one is "we chose not to run it", the other
 * is "we cannot say what happened". Neither may appear as a zero-failure layer.
 */

/** Every status a layer can report. */
export const LAYER_STATUSES = Object.freeze([
  'PASS',
  'FAIL',
  'SKIPPED',
  'NOT_RUN',
  'INCOMPLETE',
  'BLOCKED',
])

/** The canonical layer ids, in the order a reader should think about them. */
export const LAYERS = [
  { id: 'unit-frontend', label: 'Unit — frontend (vitest)', kind: 'unit' },
  { id: 'unit-rust', label: 'Unit — Rust (cargo test --lib)', kind: 'unit' },
  { id: 'unit-team-server', label: 'Unit — Team Server', kind: 'unit' },
  { id: 'scripts', label: 'Gate scripts (node --test)', kind: 'unit' },
  { id: 'command-e2e', label: 'Command E2E — SFTP over real sshd', kind: 'e2e' },
  { id: 'ipc-e2e', label: 'IPC E2E — Tauri invoke', kind: 'e2e' },
  { id: 'gui-e2e', label: 'GUI E2E — real WebView', kind: 'e2e' },
  { id: 'real-machine', label: 'Real machine — SSH/PTY matrix', kind: 'e2e' },
  { id: 'upgrade', label: 'Upgrade E2E — install chain', kind: 'e2e' },
  { id: 'release-qualification', label: 'Release qualification', kind: 'gate' },
]

const LAYER_IDS = new Set(LAYERS.map(layer => layer.id))

function assertNonNegativeInteger(value, field, id) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${id}: ${field} must be a non-negative integer, got ${JSON.stringify(value)}`)
  }
}

/**
 * Build one layer's entry.
 *
 * Throws on a malformed count rather than coercing it: a parser that produced
 * `"10"` or `-3` is broken, and silently accepting it is how a report lies. Use
 * `incompleteEntry` when the counts are genuinely unavailable.
 */
export function layerEntry(id, counts = {}) {
  if (!LAYER_IDS.has(id)) throw new Error(`unknown layer ${JSON.stringify(id)}`)
  const layer = LAYERS.find(entry => entry.id === id)

  // Normalise ONCE, before anything reads the numbers. The first version validated
  // `value ?? 0` but then summed the raw fields, so an omitted `failed` made
  // `accounted` NaN, `NaN !== total` was true, and every partial call reported
  // INCOMPLETE — including the correct ones. A validation that does not normalise the
  // value it validated is a check on a different value than the one used.
  const fields = {
    total: counts.total ?? 0,
    passed: counts.passed ?? 0,
    failed: counts.failed ?? 0,
    skipped: counts.skipped ?? 0,
    notRun: counts.notRun ?? 0,
  }
  for (const [field, value] of Object.entries(fields)) {
    assertNonNegativeInteger(value, field, id)
  }

  const accounted = fields.passed + fields.failed + fields.skipped + fields.notRun
  let status
  if (accounted !== fields.total) {
    // The conservation failure. This is INCOMPLETE, not a pass rate over a subset.
    status = 'INCOMPLETE'
  } else if (fields.total === 0) {
    status = 'NOT_RUN'
  } else if (fields.failed > 0) {
    status = 'FAIL'
  } else if (fields.passed === 0 && fields.skipped > 0) {
    status = 'SKIPPED'
  } else {
    status = 'PASS'
  }

  return {
    layer: id,
    label: layer.label,
    kind: layer.kind,
    platform: counts.platform ?? null,
    runner: counts.runner ?? null,
    runId: counts.runId ?? null,
    commitSha: counts.commitSha ?? null,
    durationMs: counts.durationMs ?? null,
    artifact: counts.artifact ?? null,
    total: fields.total,
    passed: fields.passed,
    failed: fields.failed,
    skipped: fields.skipped,
    notRun: fields.notRun,
    // What the conservation check found, so a reader can see the gap.
    unaccounted: fields.total - accounted,
    status,
    reason: counts.reason ?? null,
  }
}

/** A layer that did not execute, with a reason. Never counted as zero failures. */
export function notRunEntry(id, reason, extra = {}) {
  if (!LAYER_IDS.has(id)) throw new Error(`unknown layer ${JSON.stringify(id)}`)
  const layer = LAYERS.find(entry => entry.id === id)
  return {
    layer: id,
    label: layer.label,
    kind: layer.kind,
    platform: extra.platform ?? null,
    runner: extra.runner ?? null,
    runId: extra.runId ?? null,
    commitSha: extra.commitSha ?? null,
    durationMs: null,
    artifact: extra.artifact ?? null,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    notRun: 0,
    unaccounted: 0,
    status: 'NOT_RUN',
    reason,
  }
}

/** A layer whose counts could not be established. */
export function incompleteEntry(id, reason, extra = {}) {
  const base = notRunEntry(id, reason, extra)
  return { ...base, status: 'INCOMPLETE' }
}

/** A layer that could not run because something it needs failed. */
export function blockedEntry(id, reason, extra = {}) {
  const base = notRunEntry(id, reason, extra)
  return { ...base, status: 'BLOCKED' }
}

/**
 * Combine layers into a report.
 *
 * The pass rate is computed **only over layers whose counts conserve**. A layer that
 * did not run contributes nothing; a layer that ran partially is not silently folded
 * into a smaller denominator, it is reported as INCOMPLETE and excluded from the rate
 * while being listed as a problem.
 */
export function buildReport(layers) {
  const seen = new Set()
  for (const layer of layers) {
    if (seen.has(layer.layer)) {
      // Two reports for one layer means a duplicated artifact. Counting both would
      // double every number; picking one silently would hide the duplication.
      throw new Error(`layer ${layer.layer} was reported twice`)
    }
    seen.add(layer.layer)
  }

  const committed = layers.filter(layer => layer.status === 'PASS' || layer.status === 'FAIL' || layer.status === 'SKIPPED')
  const incomplete = layers.filter(layer => layer.status === 'INCOMPLETE')
  const blocked = layers.filter(layer => layer.status === 'BLOCKED')
  const notRun = layers.filter(layer => layer.status === 'NOT_RUN')

  const passed = committed.reduce((sum, layer) => sum + layer.passed, 0)
  const failed = committed.reduce((sum, layer) => sum + layer.failed, 0)
  const skipped = committed.reduce((sum, layer) => sum + layer.skipped, 0)
  const measured = passed + failed + skipped

  return {
    layers,
    measuredLayers: committed.length,
    incompleteLayers: incomplete.length,
    blockedLayers: blocked.length,
    notRunLayers: notRun.length,
    passed,
    failed,
    skipped,
    // `null`, never 0: "nothing measured" and "everything failed" are different claims.
    passRate: measured === 0 ? null : passed / measured,
    // "Complete" means every canonical layer produced a usable answer. A NOT_RUN layer
    // is a gap in what this report describes, even though it is not a failure.
    complete: incomplete.length === 0 && blocked.length === 0 && notRun.length === 0,
    // "Green" is narrower: nothing failed and nothing is unknown. A layer that
    // legitimately did not run (weekly matrix, release-only gate) does not make a
    // green run red — but `complete` is false, so the reader knows the scope.
    green: failed === 0 && incomplete.length === 0 && blocked.length === 0,
  }
}

export { LAYER_IDS }
