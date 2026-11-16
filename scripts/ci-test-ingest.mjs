/**
 * Turn real runner output into the test-report contract.
 *
 * ## Why parsers instead of `grep`-ing filenames
 *
 * The previous report had a static `LAYERS` array and no ingestion at all. The task's
 * rule is explicit: do not estimate executed tests from filenames, because that
 * double-counts table-driven cases and misses `#[ignore]`d ones. These parsers read
 * the machine-readable output each runner already produces:
 *
 * | Layer | Source | Format |
 * | --- | --- | --- |
 * | frontend vitest | `--reporter=json --outputFile` | vitest JSON |
 * | cargo test | `cargo test -- -Z unstable-options --format json` is nightly only; used `cargo nextest`-free approach | libtest text |
 * | node --test | `--test-reporter=tap` | TAP |
 * | team server | jest/vitest JSON | JSON |
 * | E2E harnesses | their own `result.json` | JSON |
 *
 * Every parser returns `{total, passed, failed, skipped}` or throws with the reason it
 * could not. A parser that cannot understand its input must not return zeros: zeros
 * are indistinguishable from "no failures" in a downstream report.
 */

/**
 * Parse vitest's JSON reporter output.
 *
 * Shape: `{numTotalTests, numPassedTests, numFailedTests, numPendingTests, ...}`.
 * `numPendingTests` covers both `skipped` and `todo`; vitest reports them separately
 * in `testResults`, so the detailed form is preferred when present.
 */
export function parseVitestJson(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('vitest report was not an object')
  }
  const total = parsed.numTotalTests
  const passed = parsed.numPassedTests
  const failed = parsed.numFailedTests
  if (![total, passed, failed].every(Number.isInteger)) {
    throw new Error(
      'vitest report is missing numTotalTests/numPassedTests/numFailedTests; ' +
        'pass --reporter=json --outputFile=<file> so the counts are machine-readable',
    )
  }
  const skipped = Number.isInteger(parsed.numPendingTests)
    ? parsed.numPendingTests
    : Math.max(0, total - passed - failed)
  return { total, passed, failed, skipped, durationMs: parsed.testResultsDuration ?? null }
}

/**
 * Parse libtest's text output.
 *
 * `cargo test` prints `test result: ok. 434 passed; 0 failed; 3 ignored; 0 measured; …`
 * per test binary, and a workspace runs several binaries. Summing them is correct;
 * taking only the last would miss every binary but one — which is exactly how a
 * workspace's tests disappear from a count.
 */
export function parseLibtestText(text) {
  const lines = String(text ?? '').split('\n')
  let passed = 0
  let failed = 0
  let skipped = 0
  let seen = 0
  for (const line of lines) {
    const match = /^test result: \w+\.\s+(\d+) passed;\s+(\d+) failed;\s+(\d+) ignored/.exec(line)
    if (!match) continue
    seen += 1
    passed += Number(match[1])
    failed += Number(match[2])
    skipped += Number(match[3])
  }
  if (seen === 0) {
    throw new Error('no "test result:" line found; cargo test did not run or its output was not captured')
  }
  return { total: passed + failed + skipped, passed, failed, skipped, binaries: seen }
}

/**
 * Parse TAP output, which is what `node --test --test-reporter=tap` writes.
 *
 * Only top-level `ok N` / `not ok N` lines count. Subtests are indented and would be
 * double-counted, so indentation is the signal that a line is not a top-level test.
 */
export function parseTap(text) {
  const lines = String(text ?? '').split('\n')
  let passed = 0
  let failed = 0
  let skipped = 0
  let seen = 0
  for (const line of lines) {
    // A leading space means a subtest or YAML diagnostic.
    const match = /^(not ok|ok)\s+\d+\s*(?:-\s*)?(.*)$/.exec(line)
    if (!match) continue
    seen += 1
    const rest = match[2] ?? ''
    if (/#\s*(SKIP|TODO)/i.test(rest)) skipped += 1
    else if (match[1] === 'not ok') failed += 1
    else passed += 1
  }
  if (seen === 0) {
    throw new Error('no TAP "ok"/"not ok" lines found; the runner produced no TAP output')
  }
  return { total: passed + failed + skipped, passed, failed, skipped }
}

/**
 * Parse a harness `result.json`.
 *
 * The repository's E2E scripts write `{cases: [{name, status}]}` or
 * `{passed, failed, skipped}`. Both shapes are accepted because both are already on
 * disk; a third shape is an error rather than a guess.
 */
export function parseHarnessJson(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.cases)) {
    let passed = 0
    let failed = 0
    let skipped = 0
    let other = 0
    for (const testCase of parsed.cases) {
      const status = String(testCase?.status ?? '').toUpperCase()
      if (status === 'PASS' || status === 'PASSED' || status === 'SUCCESS') passed += 1
      else if (status === 'FAIL' || status === 'FAILED') failed += 1
      else if (status === 'SKIP' || status === 'SKIPPED' || status === 'NOT_RUN') skipped += 1
      else other += 1
    }
    if (other > 0) {
      // A case with an unrecognised status is not silently a pass.
      throw new Error(`${other} harness case(s) had an unrecognised status`)
    }
    return {
      total: passed + failed + skipped,
      passed,
      failed,
      skipped,
      durationMs: parsed.durationMs ?? null,
    }
  }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    Number.isInteger(parsed.passed) &&
    Number.isInteger(parsed.failed)
  ) {
    const skipped = Number.isInteger(parsed.skipped) ? parsed.skipped : 0
    return { total: parsed.passed + parsed.failed + skipped, passed: parsed.passed, failed: parsed.failed, skipped }
  }
  throw new Error('harness report has neither a cases array nor passed/failed integers')
}

/**
 * The layer id each parser belongs to, and the environment variable that carries its
 * report path in CI. Data, so adding a layer is one entry rather than a new branch.
 */
export const INGESTION_PLAN = [
  { layer: 'unit-frontend', parser: 'vitest', glob: 'packages/frontend/test-results/vitest.json' },
  { layer: 'unit-rust', parser: 'libtest', glob: 'src-tauri/test-results/cargo-test.txt' },
  { layer: 'unit-team-server', parser: 'vitest', glob: 'packages/team-server/test-results/vitest.json' },
  { layer: 'scripts', parser: 'tap', glob: 'test-results/scripts.tap' },
  { layer: 'command-e2e', parser: 'harness', glob: 'test-results/sftp-command-e2e.json' },
  { layer: 'ipc-e2e', parser: 'harness', glob: 'test-results/sftp-ipc-e2e.json' },
  { layer: 'gui-e2e', parser: 'harness', glob: 'test-results/gui-e2e.json' },
  { layer: 'real-machine', parser: 'harness', glob: 'test-results/real-machine.json' },
  { layer: 'upgrade', parser: 'harness', glob: 'test-results/upgrade.json' },
  { layer: 'release-qualification', parser: 'harness', glob: 'test-results/release-qualification.json' },
]

/** Dispatch a parser by name. */
export function parseByKind(kind, text) {
  if (kind === 'vitest') return parseVitestJson(text)
  if (kind === 'libtest') return parseLibtestText(text)
  if (kind === 'tap') return parseTap(text)
  if (kind === 'harness') return parseHarnessJson(text)
  throw new Error(`unknown parser ${JSON.stringify(kind)}`)
}
