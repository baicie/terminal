#!/usr/bin/env node
/**
 * Aggregate per-layer test reports into one summary.
 *
 * ## The three distinctions this exists to keep
 *
 *  1. **A missing artifact is not zero tests.** A job that uploaded nothing and a job
 *     whose suite ran zero cases are different facts, and only one of them means "no
 *     failures". Missing → `NOT_RUN` with the reason; zero cases → `SKIPPED`.
 *  2. **A skipped job is visible.** `if: needs.x.result == 'success'` cascades skips;
 *     a dependent layer must show `BLOCKED`, not vanish.
 *  3. **Results from different commits never mix.** Every layer carries `commitSha`
 *     and the aggregator refuses a set with more than one.
 *
 * ## Where the numbers come from
 *
 * Each job writes its runner's own machine-readable output (vitest JSON, TAP,
 * libtest text, harness `result.json`). Inputs are read from a directory tree, one
 * file per layer, named in `INGESTION_PLAN`. Nothing is inferred from filenames.
 *
 * Usage:
 *   node scripts/aggregate-test-report.mjs --dir <reports-dir> [--sha <sha>] [--json out.json]
 *
 * Exit codes: 0 report written (whatever its verdict), 1 the report could not be built.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { INGESTION_PLAN, parseByKind } from './ci-test-ingest.mjs'
import {
  LAYERS,
  blockedEntry,
  buildReport,
  incompleteEntry,
  layerEntry,
  notRunEntry,
} from './ci-test-report.mjs'
import { renderTestReport } from './ci-test-report-render.mjs'

function parseArgs(argv) {
  const options = { dir: null, sha: null, json: null, blocked: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dir') options.dir = argv[++i]
    else if (arg === '--sha') options.sha = argv[++i]
    else if (arg === '--json') options.json = argv[++i]
    else if (arg === '--skipped' || arg === '--blocked') options.blocked.push(argv[++i])
  }
  return options
}

function findReportFile(root, relative) {
  const full = path.join(root, relative)
  try {
    const stats = statSync(full)
    if (stats.isFile() && stats.size > 0) return full
    return null
  } catch {
    return null
  }
}

/**
 * Build the layer entries from whatever is on disk.
 *
 * `skipped` names layers whose job was skipped by CI, which is `BLOCKED` when a
 * prerequisite failed and `NOT_RUN` otherwise. It is passed explicitly because a
 * missing file cannot tell the two apart.
 */
export function collectLayers({ root, plan = INGESTION_PLAN, blocked = [], commitSha = null, runId = null, platform = null }) {
  const entries = []
  const blockedSet = new Set(blocked)

  for (const layer of LAYERS) {
    const source = plan.find(candidate => candidate.layer === layer.id)
    if (!source) {
      entries.push(notRunEntry(layer.id, 'no ingestion adapter is configured for this layer', { commitSha, runId }))
      continue
    }
    const file = findReportFile(root, source.glob)

    // ## The report wins over the job result
    //
    // A job that FAILED still uploads its report (`if: always()`), and that report is
    // the only place its real counts live. An earlier version checked the job result
    // first and labelled the layer `BLOCKED` with zero totals — discarding the failing
    // suite's numbers, which is exactly what this report exists to publish.
    //
    // `blocked` therefore means only "the job did not run", derived by the caller from
    // a `skipped` result. `failure` is not blocked: it is a measured FAIL.
    if (file === null) {
      if (blockedSet.has(layer.id)) {
        entries.push(
          blockedEntry(layer.id, `the job for this layer was skipped in CI (${layer.id})`, {
            commitSha,
            runId,
            platform,
          }),
        )
      } else {
        // Missing is NOT_RUN, never zero-and-green.
        entries.push(
          notRunEntry(layer.id, `no report was uploaded (expected ${source.glob})`, { commitSha, runId, platform }),
        )
      }
      continue
    }
    let counts
    try {
      counts = parseByKind(source.parser, readFileSync(file, 'utf8'))
    } catch (error) {
      // Unparseable is INCOMPLETE, not zero.
      entries.push(
        incompleteEntry(layer.id, `could not parse ${source.glob}: ${error.message}`, {
          commitSha,
          runId,
          platform,
          artifact: source.glob,
        }),
      )
      continue
    }
    entries.push(
      layerEntry(layer.id, {
        ...counts,
        commitSha,
        runId,
        platform,
        artifact: source.glob,
        runner: source.parser,
      }),
    )
  }
  return entries
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.dir === null) {
    console.error('usage: aggregate-test-report.mjs --dir <reports-dir> [--sha <sha>] [--json out.json]')
    return 2
  }

  let entries
  try {
    entries = collectLayers({
      root: options.dir,
      blocked: options.blocked,
      commitSha: options.sha ?? process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      platform: process.env.RUNNER_OS ?? null,
    })
  } catch (error) {
    console.error(`could not aggregate: ${error.message}`)
    return 1
  }

  // Mixed SHAs would make one report describe two commits.
  const shas = new Set(entries.map(entry => entry.commitSha).filter(Boolean))
  if (shas.size > 1) {
    console.error(`refusing to aggregate results from ${shas.size} commits: ${[...shas].join(', ')}`)
    return 1
  }

  let report
  try {
    report = buildReport(entries)
  } catch (error) {
    console.error(`could not build the report: ${error.message}`)
    return 1
  }

  console.log(renderTestReport(report))

  if (options.json) {
    mkdirSync(path.dirname(path.resolve(options.json)), { recursive: true })
    writeFileSync(
      path.resolve(options.json),
      JSON.stringify({ schemaVersion: 1, generatedFor: [...shas][0] ?? null, ...report }, null, 2),
    )
  }
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
