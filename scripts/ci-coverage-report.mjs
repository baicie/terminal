/**
 * The CI coverage report: what actually ran, by layer.
 *
 * ## Why "total tests" is the wrong number
 *
 * `pnpm test` prints "255 files / 2337 passed" and that reads like coverage. It is
 * coverage of the frontend. The Rust suites, the command-level SFTP acceptance, the
 * real-WebView specs and the release qualification each answer a different question,
 * and several of them do not run in every CI job — the GUI specs need a macOS runner,
 * the real-machine matrix runs weekly, and the release gate only runs on a tag.
 *
 * A single percentage would let a week with no GUI runs look like a week with no GUI
 * failures. So every layer reports `total / passed / failed / skipped / notRun`, and
 * the pass rate is computed **only over the layers that ran**.
 *
 * ## What this does not do
 *
 * It does not discover tests. The counts come from the runners that produce them,
 * because a count derived from filenames would double-count table-driven cases and
 * miss the `#[ignore]` ones entirely.
 */

/** The layers, in the order a reader should think about them. */
export const LAYERS = [
  { id: 'unit-frontend', label: 'Unit — frontend (vitest)', cwd: 'packages/frontend' },
  { id: 'unit-rust', label: 'Unit — Rust (cargo test --lib)', cwd: 'src-tauri' },
  { id: 'unit-team-server', label: 'Unit — Team Server', cwd: 'packages/team-server' },
  { id: 'scripts', label: 'Gate scripts (node --test)', cwd: '.' },
  { id: 'command-e2e', label: 'Command E2E — SFTP over real sshd', cwd: 'src-tauri' },
  { id: 'ipc-e2e', label: 'IPC E2E — Tauri invoke', cwd: 'src-tauri' },
  { id: 'gui-e2e', label: 'GUI E2E — real WebView', cwd: 'e2e/gui' },
  { id: 'real-machine', label: 'Real machine — SSH/PTY matrix', cwd: '.' },
  { id: 'upgrade', label: 'Upgrade E2E — install chain', cwd: '.' },
  { id: 'release-qualification', label: 'Release qualification', cwd: '.' },
]

/**
 * One layer's numbers.
 *
 * `total === 0` with `notRun` set is the honest shape for a layer that did not run:
 * it contributes nothing to the pass rate rather than a hidden zero.
 */
export function layerEntry(id, { total = 0, passed = 0, failed = 0, skipped = 0, notRun = null, platform = null, note = null } = {}) {
  const layer = LAYERS.find(entry => entry.id === id)
  if (!layer) throw new Error(`unknown layer ${JSON.stringify(id)}`)
  if (passed + failed + skipped > total) {
    throw new Error(
      `${id}: passed+failed+skipped (${passed + failed + skipped}) exceeds total (${total})`,
    )
  }
  return { id, label: layer.label, total, passed, failed, skipped, notRun, platform, note }
}

/** A layer that produced no result this run. */
export function notRunEntry(id, reason, { platform = null } = {}) {
  return layerEntry(id, { notRun: reason, platform })
}

/**
 * Combine layers into a report.
 *
 * The pass rate excludes layers that did not run. An `UNKNOWN` rate is reported when
 * nothing ran at all — printing `0%` there would be a lie in the other direction.
 */
export function buildReport(layers) {
  const ran = layers.filter(layer => layer.notRun === null && layer.total > 0)
  const passed = ran.reduce((sum, layer) => sum + layer.passed, 0)
  const failed = ran.reduce((sum, layer) => sum + layer.failed, 0)
  const skipped = ran.reduce((sum, layer) => sum + layer.skipped, 0)
  const measured = passed + failed + skipped

  return {
    layers,
    ranLayers: ran.length,
    notRunLayers: layers.filter(layer => layer.notRun !== null).length,
    passed,
    failed,
    skipped,
    // `null` rather than 0: "nothing ran" and "everything failed" are different.
    passRate: measured === 0 ? null : passed / measured,
  }
}

/** Render the Markdown a reader gets in a job summary. */
export function renderCoverage(report) {
  const lines = [
    '## Test coverage by layer',
    '',
    '| Layer | Platform | Total | Passed | Failed | Skipped | Not run |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const layer of report.layers) {
    const notRun = layer.notRun ? layer.notRun.slice(0, 60) : '—'
    lines.push(
      `| ${layer.label} | ${layer.platform ?? '—'} | ${layer.total} | ${layer.passed} | ${layer.failed} | ${layer.skipped} | ${notRun} |`,
    )
  }
  lines.push('')
  if (report.passRate === null) {
    lines.push(
      '**Pass rate:** not computed — no layer produced results. A 0% here would read ' +
        'as "everything failed", which is a different statement.',
    )
  } else {
    lines.push(
      `**Pass rate:** ${(report.passRate * 100).toFixed(1)}% over ${report.ranLayers} layer(s) ` +
        `(${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped). ` +
        `${report.notRunLayers} layer(s) did not run and are excluded.`,
    )
  }
  return lines.join('\n')
}
