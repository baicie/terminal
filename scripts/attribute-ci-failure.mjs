#!/usr/bin/env node
/**
 * Print the failure attribution for one CI run.
 *
 * Reads the job list (from `gh api .../jobs`) and writes a Markdown table to stdout,
 * which the workflow appends to `$GITHUB_STEP_SUMMARY`. The classification itself
 * lives in `ci-failure-attribution.mjs` and is unit-tested; this file only fetches and
 * formats.
 *
 * Usage: `node scripts/attribute-ci-failure.mjs <jobs.json>`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { classifyRun, renderReport } from './ci-failure-attribution.mjs'

/**
 * Fetch a job's log tail.
 *
 * `gh` returns logs only for completed jobs, and the failure text needed to classify
 * is near the end. A missing log is not fatal — the classifier falls back to the job
 * name, and `UNKNOWN` is an honest answer.
 */
function logTail(job, { maxChars = 4000 } = {}) {
  try {
    const text = execFileSync('gh', ['api', `repos/${process.env.REPO}/actions/jobs/${job.id}/logs`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    })
    return text.slice(-maxChars)
  } catch {
    return ''
  }
}

function main() {
  const jobsPath = process.argv[2]
  if (!jobsPath) {
    console.error('usage: attribute-ci-failure.mjs <jobs.json>')
    return 2
  }
  let jobs
  try {
    jobs = JSON.parse(readFileSync(path.resolve(jobsPath), 'utf8'))
  } catch (error) {
    // A malformed job list is not a clean run. Say so rather than printing nothing,
    // which a reader would take as "nothing failed".
    console.log('## CI failure attribution\n\nCould not read the job list: ' + error.message)
    return 1
  }

  if (!Array.isArray(jobs)) {
    console.log('## CI failure attribution\n\nThe job list was not an array.')
    return 1
  }

  // Only failing jobs need a log fetch; the rest contribute nothing to the verdict.
  const enriched = jobs.map(job =>
    job.conclusion === 'failure' ? { ...job, logText: logTail(job) } : job,
  )

  const result = classifyRun({
    conclusion: enriched.some(job => job.conclusion === 'failure') ? 'failure' : 'success',
    jobs: enriched,
  })
  console.log(renderReport(result))
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
