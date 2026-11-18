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
 * Read the per-case evidence files the specs themselves write.
 *
 * ## Why the wdio counts are not enough
 *
 * `json/wdio-*.json` only records whether a case **threw**. A spec that decides a
 * precondition is missing can record `NOT_RUN` and return normally — the case passes,
 * the wdio file says `failed: 0`, and the layer reports PASS.
 *
 * Measured on run 44230712100: all three platforms reported `status: PASS,
 * passed: 25, failed: 0`, while `e2e-04.json` recorded `verdict: PARTIAL` on macOS and
 * Windows and `PARTIAL` with **four** NOT_RUNs on Linux, where the snippet dock never
 * opened at all. The one thing the GUI gate exists to catch had no way to fail.
 *
 * So the specs' own verdicts are read and reported, and a failing verdict makes the
 * layer fail. `PARTIAL` does not fail the build on its own — a documented gap (no
 * model endpoint) is not a regression — but it is never counted as a pass either, and
 * a `PARTIAL` whose NOT_RUN entries name something REQUIRED does.
 */
export function readCaseEvidence(artifactsDir) {
  const cases = []
  let names
  try {
    names = readdirSync(artifactsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return { cases, missing: true }
  }
  const unreadable = []
  for (const name of names) {
    const file = path.join(artifactsDir, name, `${name}.json`)
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      /*
       * Not every directory under the artifacts root is a case: `json/` holds the
       * wdio files, `screens/` sits inside each case. A directory with no
       * `<name>.json` at all is not a case that failed to write evidence — it is not
       * a case. Only a file that exists and cannot be parsed is a problem.
       */
      if (error?.code === 'ENOENT') continue
      /*
       * A case directory whose evidence cannot be read is recorded, not skipped.
       *
       * The wdio side already treats this as INCOMPLETE (a 0-byte `wdio-*.json` is
       * what a crashed spec leaves behind). The case side did not, so a spec that
       * died inside `after()` — the one place its verdict is written — looked like a
       * spec that simply ran no cases. Measured before this: illegal JSON in
       * `e2e-04/e2e-04.json` with `wdio passed:6/failed:0` produced `status: PASS`.
       */
      unreadable.push(name)
      continue
    }
    cases.push({
      case: parsed.case ?? name,
      verdict: parsed.verdict ?? null,
      /*
       * Two shapes exist in this repository, and only one was read.
       *
       * `e2e-04` writes `extra.notRunCount` (a number). `e2e-01` writes
       * `extra.notRun` (an array of reasons) and has no count. Reading only the
       * number meant e2e-01's PARTIAL — including its "no local terminal tab exists
       * in this run" path, which is a launch regression — sailed through the
       * declared-gap rule untouched: measured, a PARTIAL e2e-01 with one NOT_RUN
       * produced `status: PASS` and `unexplainedNotRun: []`.
       *
       * Reading both is not a compatibility shim: it is what makes the rule apply to
       * every spec that writes evidence. The array form is at least as specific as
       * the count, since each entry names a reason.
       */
      notRunCount:
        parsed.extra?.notRunCount ??
        (Array.isArray(parsed.extra?.notRun) ? parsed.extra.notRun.length : null),
      // Gaps the spec declared up front. A NOT_RUN beyond these came from a path the
      // spec could not complete, which is the difference between a documented
      // environment limit and a product surface that did not work.
      gaps: Array.isArray(parsed.extra?.gaps) ? parsed.extra.gaps : [],
      failures: Array.isArray(parsed.extra?.failures) ? parsed.extra.failures.length : null,
      // A REQUIRED occupant that did not open is recorded in the case's own notes by
      // the spec's failure path, so the failure list is the authoritative signal.
      recordedAt: parsed.recordedAt ?? null,
    })
  }
  return { cases, missing: false, unreadable }
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
  const caseEvidence = readCaseEvidence(artifactsDir)

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
  // A case's own verdict can fail the layer even when no case threw. This is the half
  // the wdio counts cannot see: a spec that records NOT_RUN and returns normally still
  // reports `failed: 0`.
  const failedCases = caseEvidence.cases.filter(entry => entry.verdict === 'FAIL')
  const partialCases = caseEvidence.cases.filter(entry => entry.verdict === 'PARTIAL')
  // An unreadable spec file makes the total a lower bound. That is INCOMPLETE, not PASS —
  // and not FAIL either, because nothing here says those cases failed.
  /*
   * ## A PARTIAL over a gap that should not exist is a failure
   *
   * `PARTIAL` means "some claims were not exercised". That is legitimate for a missing
   * model endpoint. It is NOT legitimate for a REQUIRED UI surface: the Linux run
   * recorded `PARTIAL` with four NOT_RUNs because the snippet dock did not open, and a
   * `PARTIAL`-tolerant status let the job stay green.
   *
   * The spec distinguishes the two itself: a gap it declares in `gaps` is expected
   * (no endpoint, no sshd), and anything else that produced a NOT_RUN came from a path
   * the spec could not complete. So: a case whose `notRunCount` exceeds its declared
   * gap count, or whose verdict is FAIL, fails the layer.
   */
  /*
   * ## Coverage, not a count of entries
   *
   * A gap may account for several NOT_RUNs — e2e-03's six remote cases all skip for
   * one reason ("no connected SFTP session"), and requiring six separate declarations
   * would push a spec toward either lying or listing the same sentence six times.
   *
   * But a single declaration must not silently absorb unrelated skips either. So each
   * gap says how many NOT_RUNs it accounts for, and the sum has to match. A spec that
   * over-claims loses the layer; a spec that under-claims and has an extra unexplained
   * skip loses it too.
   */
  const coverage = entry => {
    const gaps = entry.gaps ?? []
    if (gaps.length === 0) return 0
    // `covers` defaults to 1 so the common one-gap-one-skip case needs no annotation.
    return gaps.reduce((total, gap) => total + (Number.isFinite(gap.covers) ? gap.covers : 1), 0)
  }
  const unexplainedNotRun = caseEvidence.cases.filter(entry => {
    if (entry.verdict === 'FAIL') return false // counted separately
    if (entry.notRunCount === null) return false
    return entry.notRunCount > coverage(entry)
  })

  const status =
    counts.failed > 0 || failedCases.length > 0 || unexplainedNotRun.length > 0
      ? 'FAIL'
      : total === 0
        ? 'NOT_RUN'
        : counts.corrupt.length > 0 || (caseEvidence.unreadable ?? []).length > 0
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
    // Case evidence that exists but could not be parsed. A spec writes its verdict in
    // `after()`; a crash there leaves exactly this, and calling it "no cases ran" is
    // how a broken run reads as a clean one.
    unreadableCaseEvidence: caseEvidence.unreadable ?? [],
    // ## What the cases said about themselves
    //
    // Kept separate from `passed` on purpose. A NOT_RUN that is folded into a pass
    // count is the exact failure this report was extended to prevent, so the gaps are
    // listed by name and the count is visible next to the wdio numbers rather than
    // inside them.
    cases: caseEvidence.cases.map(entry => ({
      case: entry.case,
      verdict: entry.verdict,
      notRunCount: entry.notRunCount,
    })),
    partialCases: partialCases.map(entry => entry.case),
    failedCases: failedCases.map(entry => entry.case),
    // The NOT_RUNs that are not covered by a declared gap: a surface that should have
    // worked and did not. These fail the layer.
    unexplainedNotRun: unexplainedNotRun.map(entry => ({
      case: entry.case,
      notRunCount: entry.notRunCount,
      declaredCoverage: coverage(entry),
    })),
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

/**
 * Exit status is part of the contract, not a formality.
 *
 * This used to `return 0` unconditionally. Combined with the workflow step being
 * `if: always()`, that meant the report could say `status: "FAIL"` and the job would
 * still be green — a third way for the same green job to describe a broken run. The
 * file is still written before exiting, so the artifact upload keeps the diagnosis.
 *
 * Only FAIL fails the step. `NOT_RUN` and `INCOMPLETE` stay exit 0: they say the
 * suite produced nothing usable, which the *runner* step already failed to produce,
 * and turning them into a second failure here would report one problem twice.
 */
function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const report = buildGuiReport({ artifactsDir: path.resolve(options.artifacts), platform: options.platform })
  const text = `${JSON.stringify(report, null, 2)}\n`
  process.stdout.write(text)
  if (options.out) {
    const target = path.resolve(options.out)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  return report.status === 'FAIL' ? 1 : 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}

export { main }
