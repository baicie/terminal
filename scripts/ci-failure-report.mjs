/**
 * Rendering for the attribution report.
 *
 * Split from `ci-failure-attribution.mjs` so the classification rules and the prose a
 * reader sees can be reviewed independently. The separation matters for one specific
 * reason: the report has to show **four facts that are not derived from one another**,
 * and the previous single `Blocking: no` line was read as "this PR merges".
 *
 *   Classification        what kind of failure this is
 *   Human action          what a person should do
 *   Required check result did a merge-gating check fail (never softened)
 *   Merge eligibility     is this commit mergeable, given the gate
 */
import { LOG_UNAVAILABLE_REASONS } from './ci-log-status.mjs'

/** Render the report a reader sees in a job summary. */
export function renderReport(result, { runUrl = null } = {}) {
  const lines = ['## CI failure attribution', '']

  if (result.category === null && result.runVerdict !== 'running') {
    lines.push('No job failed.')
    appendRunFacts(lines, result, runUrl)
    return lines.join('\n')
  }

  lines.push(
    `**Category:** \`${result.category ?? 'PENDING'}\``,
    `**Run verdict:** \`${result.runVerdict ?? 'unknown'}\``,
    `**What to do:** ${result.action}`,
  )
  if (result.detail) lines.push(`**Detail:** ${result.detail}`)
  lines.push('')

  lines.push(
    '| Question | Answer |',
    '| --- | --- |',
    `| Classification | \`${result.category ?? 'PENDING'}\` |`,
    `| Human action | ${result.action} |`,
    `| Required check result | ${describeRequired(result.requiredCheckFailed)} |`,
    `| Merge eligibility | ${describeEligibility(result.mergeEligibility)} |`,
    '',
  )

  if (result.jobs.length > 0) {
    lines.push(
      '| Job | Conclusion | Category | Blocking | Informational | Log |',
      '| --- | --- | --- | --- | --- | --- |',
    )
    for (const job of result.jobs) {
      lines.push(
        `| ${job.job} | ${job.conclusion ?? '—'} | \`${job.category}\` | ${job.blocking ? 'yes' : 'no'} | ` +
          `${job.informational ? 'yes' : 'no'} | ${describeLog(job.logStatus)} |`,
      )
    }
    lines.push('')
  }

  if (result.notEvaluated?.length > 0) {
    lines.push('**Jobs with no usable result**', '')
    for (const entry of result.notEvaluated) {
      lines.push(`- ${entry.job}: ${entry.reason}`)
    }
    lines.push('')
  }

  appendRunFacts(lines, result, runUrl)
  return lines.join('\n')
}

/**
 * Collection status for workflows this run cannot see.
 *
 * `NOT_COLLECTED` is a first-class outcome. The GUI jobs live in `native-gui-e2e.yml`,
 * a different workflow with a different run id, so `ci.yml`'s attribution step never
 * sees them. Printing nothing there would read as "no GUI failure".
 */
export function renderCollectionStatus(collection) {
  if (!collection) return ''
  const lines = ['', '**Collection status**', '']
  lines.push(`- self: ${collection.self.status}${collection.self.reason ? ` (${collection.self.reason})` : ''}`)
  for (const sibling of collection.siblings ?? []) {
    lines.push(
      `- ${sibling.workflow}: ${sibling.status}` +
        `${sibling.reason ? ` — ${sibling.reason}` : ''}` +
        `${sibling.runId ? ` (run ${sibling.runId})` : ''}`,
    )
  }
  return lines.join('\n')
}

function appendRunFacts(lines, result, runUrl) {
  if (runUrl) lines.push(`Run: ${runUrl}`)
  lines.push(
    '',
    '> The classification describes **why** a job did not succeed. It never clears a',
    '> required check: a failed `CI / required` blocks the merge whatever this table says.',
  )
}

function describeRequired(value) {
  if (value === true) return '**failed** — the merge gate is blocked'
  if (value === false) return 'passed'
  return 'not collected in this context'
}

function describeEligibility(value) {
  if (value === 'blocked') return 'blocked'
  if (value === 'eligible') return 'eligible'
  if (value === 'pending') return 'pending'
  return 'not evaluated'
}

function describeLog(status) {
  if (status === null || status === undefined) return 'not requested'
  if (status === 'ok') return 'read'
  return `\`LOG_UNAVAILABLE\`: ${LOG_UNAVAILABLE_REASONS[status] ?? status}`
}
