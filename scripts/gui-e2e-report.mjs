#!/usr/bin/env node
/**
 * Turn the GUI E2E run's artifacts into one machine-readable layer report.
 *
 * ## Why this exists
 *
 * The GUI suite already writes two kinds of structured output, but neither is usable by
 * the aggregator on its own:
 *
 *   `run-summary.json`  — has `verdict` and `exitCode`, **no counts**
 *   `json/wdio-*.json`  — one file per spec, each with `state: {passed, failed, skipped}`
 *
 * Summing the per-spec files is correct (each is a separate app process), but "how many
 * files are there" is not the same as "how many cases ran": a spec whose `before all`
 * hook failed produces a file with `failed: 1` and zero tests, and a spec that never
 * started produces no file at all. Both are reported here rather than being folded into
 * a total that looks clean.
 *
 * ## The distinction this preserves
 *
 *   no wdio files at all   -> NOT_RUN  (the suite did not execute)
 *   files with failures    -> FAIL     (and the counts are real)
 *   a hook-only failure    -> FAIL     with `failed >= 1`, not "0 tests passed"
 *
 * Usage: node scripts/gui-e2e-report.mjs --artifacts <dir> --out <file>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function parseArgs(argv) {
  const options = { artifacts: 'e2e/gui/artifacts', out: null, platform: process.env.RUNNER_OS ?? null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--artifacts') options.artifacts = argv[++i]
    else if (argv[i] === '--out') options.out = argv[++i]
    else if (argv[i] === '--platform') options.platform = argv[++i]
  }
  return options
}

/**
 * The run the artifacts belong to, by the newest `wdio-*-<epoch-ms>.json` name.
 *
 * ## Why this is necessary, and why the newest is the right window
 *
 * wdio names each output `wdio-<cid>-<index>-<epoch-ms>.json`, and the artifacts
 * directory **accumulates across runs**: the committed `e2e/gui/artifacts/json/`
 * currently holds 134 files spanning many historical runs. Summing all of them produced
 *
 *   total: 590   passed: 527   failed: 63
 *
 * which describes no run that ever happened. A per-layer number has to be per-run.
 *
 * The window is "files whose timestamp is within `RUN_WINDOW_MS` of the newest", which
 * is how a single invocation's specs group (they start seconds apart). A run that had one
 * spec would report one; files from older runs fall outside the window and are excluded.
 */
const RUN_WINDOW_MS = 60 * 60 * 1000

function newestRunFiles(files) {
  const stamped = files
    .map(name => {
      const match = /-(\d{13})\.json$/.exec(name)
      return match === null ? null : { name, at: Number(match[1]) }
    })
    .filter(Boolean)
  if (stamped.length === 0) {
    // No timestamps at all (e.g. a hand-written fixture): use everything as one run.
    return { files, windowStart: null, newest: null }
  }
  const newest = Math.max(...stamped.map(entry => entry.at))
  const windowStart = newest - RUN_WINDOW_MS
  return {
    files: stamped.filter(entry => entry.at >= windowStart).map(entry => entry.name),
    windowStart,
    newest,
  }
}

/** Sum the newest run's `json/wdio-*.json` state blocks. */
export function summariseGuiArtifacts(artifactsDir) {
  const jsonDir = path.join(artifactsDir, 'json')
  let all
  try {
    all = readdirSync(jsonDir).filter(name => name.endsWith('.json'))
  } catch {
    return { ran: false, reason: `no wdio output under ${jsonDir}`, passed: 0, failed: 0, skipped: 0, specs: 0 }
  }
  const { files, windowStart, newest } = newestRunFiles(all)
  const excluded = all.length - files.length

  let passed = 0
  let failed = 0
  let skipped = 0
  let specs = 0
  const corrupt = []

  for (const name of files) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path.join(jsonDir, name), 'utf8'))
    } catch {
      // ## One unreadable file must not void the whole layer
      //
      // A 0-byte `wdio-*.json` is what a crashed spec leaves behind (the repository has
      // one committed, `wdio-0-0-1794633041256.json`). The first version of this
      // function returned NOT_RUN for the entire layer when it met that file, discarding
      // the eleven specs whose state was perfectly readable — the same "one bad input
      // hides the real numbers" shape this report exists to avoid.
      //
      // The file is recorded instead, and the layer is INCOMPLETE: the counts below are
      // real but partial, which is a different claim from "nothing ran".
      corrupt.push(name)
      continue
    }
    const state = parsed?.state
    if (state === null || typeof state !== 'object') continue
    specs += 1
    passed += Number(state.passed ?? 0)
    failed += Number(state.failed ?? 0)
    skipped += Number(state.skipped ?? 0)
  }

  if (specs === 0) {
    return {
      ran: false,
      reason:
        corrupt.length > 0
          ? `every wdio file was unreadable (${corrupt.length})`
          : 'wdio wrote no state block',
      passed: 0,
      failed: 0,
      skipped: 0,
      specs: 0,
      corrupt,
    }
  }
  return { ran: true, passed, failed, skipped, specs, corrupt, windowStart, newest, excluded }
}

/**
 * The run's own verdict, when it is available.
 *
 * ## Reported, never authoritative
 *
 * `run-summary.json` is written once per `run-gui-e2e.mjs` invocation, but the `json/`
 * directory accumulates, so the two can describe different runs. Measured in the
 * committed artifacts: the newest window holds 38 specs with 15 failing cases while
 * `run-summary.json` says `verdict: PASS` — that summary is from an earlier invocation.
 *
 * So this is surfaced as context (`runVerdict`) and the counts decide the status. A
 * report that took the summary's word would have said PASS over 15 failures.
 */
export function readRunVerdict(artifactsDir) {
  try {
    const summary = JSON.parse(readFileSync(path.join(artifactsDir, 'run-summary.json'), 'utf8'))
    return { verdict: summary.verdict ?? null, exitCode: summary.exitCode ?? null, ranAt: summary.ranAt ?? null }
  } catch {
    return { verdict: null, exitCode: null, ranAt: null }
  }
}

/**
 * Build the layer report.
 *
 * `status` follows the aggregator's contract: FAIL when anything failed, NOT_RUN when the
 * suite produced no output, PASS otherwise. It is deliberately **not** derived from
 * `run-summary.verdict` alone — a suite can exit 1 while every recorded case passed (a
 * teardown error), and the counts are the more specific fact.
 */
export function buildGuiReport({ artifactsDir, platform = null }) {
  const counts = summariseGuiArtifacts(artifactsDir)
  const run = readRunVerdict(artifactsDir)

  if (!counts.ran) {
    return {
      layer: 'gui-e2e',
      platform,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      notRun: 1,
      status: 'NOT_RUN',
      reason: `${counts.reason}; run verdict ${run.verdict ?? 'unknown'}, exit ${run.exitCode ?? 'unknown'}`,
    }
  }

  const total = counts.passed + counts.failed + counts.skipped
  // An unreadable spec file makes the total a lower bound. That is INCOMPLETE, not PASS —
  // and not FAIL either, because nothing here says those cases failed.
  const status =
    counts.failed > 0
      ? 'FAIL'
      : total === 0
        ? 'NOT_RUN'
        : counts.corrupt.length > 0
          ? 'INCOMPLETE'
          : 'PASS'
  return {
    layer: 'gui-e2e',
    platform,
    total,
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    notRun: 0,
    status,
    reason:
      counts.corrupt.length > 0
        ? `${counts.corrupt.length} spec file(s) were unreadable and are excluded: ${counts.corrupt.join(', ')}`
        : null,
    specs: counts.specs,
    corruptFiles: counts.corrupt,
    runVerdict: run.verdict,
    runVerdictAt: run.ranAt,
    // ## When the summary disagrees with the counts, say so
    //
    // They come from different invocations, and the counts are the more specific fact.
    // Silently preferring either one is how a PASS got written over 15 failures.
    verdictConflict:
      run.verdict === 'PASS' && counts.failed > 0
        ? `run-summary.json says PASS (${run.ranAt ?? 'unknown time'}) but the newest ` +
          `window has ${counts.failed} failing case(s); the summary predates this window`
        : null,
    // Said out loud so a reader does not mistake a per-run count for the whole history.
    runWindow: counts.windowStart
      ? { newest: counts.newest, windowStartMs: counts.windowStart, excludedOlderFiles: counts.excluded }
      : null,
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildGuiReport({ artifactsDir: path.resolve(options.artifacts), platform: options.platform })
  const text = `${JSON.stringify(report, null, 2)}\n`
  process.stdout.write(text)
  if (options.out) {
    const target = path.resolve(options.out)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
