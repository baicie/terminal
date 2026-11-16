/**
 * Render the test execution report.
 *
 * This is a **test execution** report — which layers ran, how many cases each had,
 * and what was not measured. It is not line coverage, and calling it "coverage" was
 * the source of the earlier confusion: a reader saw one percentage and assumed it
 * described the whole suite.
 */
import { LAYERS } from './ci-test-report.mjs'

const STATUS_ORDER = ['FAIL', 'INCOMPLETE', 'BLOCKED', 'NOT_RUN', 'SKIPPED', 'PASS']

/** Render the Markdown a reader gets in a job summary. */
export function renderTestReport(report) {
  const lines = [
    '## Test execution report',
    '',
    '| Layer | Status | Platform | Total | Passed | Failed | Skipped | Not run | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]

  const byId = new Map(report.layers.map(layer => [layer.layer, layer]))
  // Iterate the canonical order so a missing layer is visibly absent rather than
  // simply not printed.
  for (const layer of LAYERS) {
    const entry = byId.get(layer.id)
    if (!entry) {
      lines.push(`| ${layer.label} | \`MISSING\` | — | — | — | — | — | — | no entry in the report |`)
      continue
    }
    const note = entry.reason ? entry.reason.slice(0, 80) : entry.unaccounted > 0 ? `${entry.unaccounted} unaccounted` : '—'
    lines.push(
      `| ${entry.label} | \`${entry.status}\` | ${entry.platform ?? '—'} | ${entry.total} | ${entry.passed} | ` +
        `${entry.failed} | ${entry.skipped} | ${entry.notRun} | ${note} |`,
    )
  }

  lines.push('')
  if (report.passRate === null) {
    lines.push(
      '**Pass rate:** not computed — no layer produced a conserving set of counts. ' +
        'A 0% here would read as "everything failed", which is a different statement.',
    )
  } else {
    lines.push(
      `**Pass rate:** ${(report.passRate * 100).toFixed(1)}% over ${report.measuredLayers} measured layer(s) ` +
        `(${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped).`,
    )
  }

  const gaps = []
  if (report.incompleteLayers > 0) gaps.push(`${report.incompleteLayers} INCOMPLETE (counts do not conserve)`)
  if (report.blockedLayers > 0) gaps.push(`${report.blockedLayers} BLOCKED (a prerequisite failed)`)
  if (report.notRunLayers > 0) gaps.push(`${report.notRunLayers} NOT_RUN (no report uploaded)`)
  if (gaps.length > 0) {
    lines.push('', `**Not measured this run:** ${gaps.join('; ')}. These are not zero-failure layers.`)
  }

  lines.push(
    '',
    `**Verdict:** ${report.green ? 'GREEN' : 'NOT GREEN'}` +
      `${report.complete ? '' : ' — the report is incomplete, see the notes above'}`,
    '',
    '> This is a test **execution** report: which layers ran and how many cases each had.',
    '> It is not line coverage and does not describe code paths that no test exercised.',
  )

  return lines.join('\n')
}

/** Sort layer entries worst-first, for a compact "what needs attention" list. */
export function sortBySeverity(layers) {
  return [...layers].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
}
