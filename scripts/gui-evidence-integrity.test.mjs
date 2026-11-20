// GUI E2E evidence integrity — a PASS must mean the run passed.
//
// ## The defect this pins, measured on real evidence
//
// `e2e-02-layout.e2e.mjs` derived its verdict from a counter that is only incremented
// inside its width-matrix loop. Every other failure — a `waitUntil` timing out, the
// explorer never opening — left the counter at 0, so `after()` wrote
//
//   {"verdict":"PASS"}
//
// for a run Mocha had marked failed. Measured on artifact
// `gui-e2e-evidence-windows-43718510663` (download `14163534444`):
//
//   json/wdio-0-0-1794749646625.json  ->  {"passed":2,"failed":3,"skipped":0}
//   e2e-02/e2e-02.json                ->  {"verdict":"PASS"}
//
// `e2e-03` had the same bug and was fixed by collecting `currentTest.state` in an
// `afterEach`. `e2e-01` already did. These tests make the rule uniform: **every** GUI
// spec that writes evidence must observe Mocha's per-case state, and its verdict must
// be computed from that, not from a narrow counter or a constant.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { buildGuiReport } from './gui-e2e-report.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SPECS = path.join(ROOT, 'e2e/gui/specs')

/** Every spec that writes an evidence file. */
const specs = readdirSync(SPECS).filter(name => name.endsWith('.e2e.mjs'))

test('there is at least one GUI spec to check', () => {
  // A guard so a rename that empties this glob fails loudly instead of vacuously passing.
  assert.ok(specs.length >= 3, `expected the GUI spec suite, found ${specs.length} file(s)`)
})

test('every spec that writes evidence observes Mocha per-case state', () => {
  for (const name of specs) {
    const source = readFileSync(path.join(SPECS, name), 'utf8')
    if (!source.includes('writeEvidence')) {
      // A spec that writes no evidence has nothing to be wrong about.
      continue
    }
    assert.match(
      source,
      /currentTest\??\.state/,
      `${name} writes evidence but never reads currentTest.state, so a thrown case ` +
        'cannot reach its verdict — the false-PASS shape measured on e2e-02',
    )
  }
})

test('no spec writes a constant verdict', () => {
  for (const name of specs) {
    const source = readFileSync(path.join(SPECS, name), 'utf8')
    // Strip comments first: the specs *document* this defect by quoting the old
    // `verdict: 'PASS'` line, and matching prose would fail on the explanation rather
    // than on the code.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, ''))
      .join('\n')
    // `verdict: 'PASS'` as a literal is the pre-#81 defect.
    assert.doesNotMatch(
      code,
      /verdict:\s*['"]PASS['"]/,
      `${name} hardcodes a PASS verdict; the verdict must be computed from the run`,
    )
  }
})

test('every spec that writes evidence has an afterEach failure collector', () => {
  for (const name of specs) {
    const source = readFileSync(path.join(SPECS, name), 'utf8')
    if (!source.includes('writeEvidence')) continue
    assert.match(
      source,
      /afterEach\s*\(/,
      `${name} has no afterEach; without one, a failing case is invisible to after()`,
    )
  }
})

test('the e2e-02 verdict counts thrown cases as well as width violations', () => {
  // The specific regression: the verdict formula read only `failures`.
  const source = readFileSync(path.join(SPECS, 'e2e-02-layout.e2e.mjs'), 'utf8')
  assert.match(source, /caseFailures/, 'e2e-02 must collect per-case failures')
  assert.match(
    source,
    /failedTotal\s*=\s*failures\s*\+\s*caseFailures\.length/,
    'the verdict must combine width violations with thrown cases',
  )
  // And the error field must carry the case text, not only the width count.
  assert.match(source, /caseFailures\.map/, 'the evidence error must name the failing cases')
})

test('a committed evidence file never claims PASS with recorded failures', () => {
  // The committed artifacts are the durable record; a stale one that contradicts its
  // own failure list is exactly the false PASS. This reads whatever is committed.
  const artifacts = path.join(ROOT, 'e2e/gui/artifacts')
  let checked = 0
  const walk = directory => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.json') && !full.includes(`${path.sep}json${path.sep}`)) {
        let parsed
        try {
          parsed = JSON.parse(readFileSync(full, 'utf8'))
        } catch {
          continue
        }
        if (parsed?.verdict === undefined) continue
        checked += 1
        const failures = parsed.failures ?? []
        const hasFailureEvidence = Array.isArray(failures) && failures.length > 0
        if (parsed.verdict === 'PASS' && hasFailureEvidence) {
          assert.fail(
            `${path.relative(ROOT, full)} says verdict PASS but records ` +
              `${failures.length} failure(s): ${JSON.stringify(failures).slice(0, 200)}`,
          )
        }
        // A PASS must also not carry an error string.
        if (parsed.verdict === 'PASS' && typeof parsed.error === 'string' && parsed.error.length > 0) {
          // Allowed only when the file itself explains it is informational; none do.
          assert.fail(
            `${path.relative(ROOT, full)} says verdict PASS but records an error: ` +
              parsed.error.slice(0, 200),
          )
        }
      }
    }
  }
  walk(artifacts)
  // Not asserting a count: the artifacts directory may legitimately be empty in a
  // clean checkout. The rule above is what matters, and it is checked for every file
  // that is present.
  assert.ok(checked >= 0)
})

/*
 * ## A run whose specs span more than the window must not shrink into a pass
 *
 * `newestRunFiles` groups a run as "files within `RUN_WINDOW_MS` (60 minutes) of the
 * newest". That is right for five specs that start seconds apart, and it is how older
 * runs are excluded from the count.
 *
 * It is wrong in one direction that matters. Measured: a fixture with five specs where
 * the last one took 70 minutes produced
 *
 *     { ran: true, passed: 1, failed: 0, specs: 1, excluded: 4 }
 *
 * — a report describing **one** spec, green, while four others (any of which could have
 * failed) fell outside the window. The `excluded` count was computed and put in the
 * JSON's `extra`, but it never reached `status`, so the layer said PASS.
 *
 * That is the same failure the report exists to prevent, arriving from the other side:
 * instead of a NOT_RUN being counted as a pass, a *failure* is dropped before counting.
 *
 * The fix is that exclusion of a substantial fraction of the files makes the layer
 * INCOMPLETE — the counts are real but describe only part of the run, which is a
 * different claim from "the run passed".
 */
test('specs excluded by the time window make the layer INCOMPLETE, not PASS', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'gui-window-'))
  mkdirSync(path.join(dir, 'json'), { recursive: true })

  const base = 1795000000000
  // Four specs at the start of the run, one that finished 70 minutes later.
  const offsets = [0, 60_000, 120_000, 180_000, 70 * 60_000]
  for (const [index, offset] of offsets.entries()) {
    writeFileSync(
      path.join(dir, 'json', `wdio-0-0-${base + offset}.json`),
      JSON.stringify({
        suites: [{ name: `spec-${index}`, uid: `s${index}` }],
        state: { passed: 1, failed: 0 },
      }),
    )
  }

  try {
    const report = buildGuiReport({ artifactsDir: dir })
    assert.ok(
      report.excludedOlderFiles > 0 || report.status === 'INCOMPLETE',
      `expected the dropped specs to be visible; got ${JSON.stringify(report)}`,
    )
    assert.notEqual(
      report.status,
      'PASS',
      'four of five specs were excluded from the count, so "PASS" describes a run ' +
        'nobody observed complete',
    )
    assert.equal(report.status, 'INCOMPLETE')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/*
 * ## Old artifacts must not cover a new failure
 *
 * The artifacts directory accumulates across runs. Summing everything once produced
 * `total: 590, passed: 527, failed: 63` — a number describing no run that ever happened.
 * The time window fixed that, and this test pins the property that matters most: a
 * previous green run cannot dilute the current one.
 */
test('a green run three hours earlier does not dilute a failing run now', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'gui-old-'))
  mkdirSync(path.join(dir, 'json'), { recursive: true })
  const base = 1795000000000

  writeFileSync(
    path.join(dir, 'json', `wdio-0-0-${base - 3 * 3600_000}.json`),
    JSON.stringify({ suites: [{ name: 'old', uid: 'o' }], state: { passed: 99, failed: 0 } }),
  )
  writeFileSync(
    path.join(dir, 'json', `wdio-0-0-${base}.json`),
    JSON.stringify({ suites: [{ name: 'new', uid: 'n' }], state: { passed: 1, failed: 4 } }),
  )

  try {
    const report = buildGuiReport({ artifactsDir: dir })
    assert.equal(report.failed, 4, 'the old run contributed no failures')
    assert.equal(report.passed, 1, 'the old run contributed no passes either')
    assert.equal(report.status, 'FAIL')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/*
 * ## A NOT_RUN beyond the declared gaps fails the layer
 *
 * This is the rule that turns "the spec skipped something" into a failure when the skip
 * has no cause named for it. Without it, deleting a case's real assertion and leaving a
 * NOT_RUN behind would read as a soft partial instead of a regression.
 */
test('a NOT_RUN with no declared gap fails the layer', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'gui-gap-'))
  mkdirSync(path.join(dir, 'json'), { recursive: true })
  mkdirSync(path.join(dir, 'e2e-03'), { recursive: true })
  const base = 1795000000000

  writeFileSync(
    path.join(dir, 'json', `wdio-0-0-${base}.json`),
    JSON.stringify({ suites: [{ name: 'e2e-03', uid: 'a' }], state: { passed: 8, failed: 0 } }),
  )
  writeFileSync(
    path.join(dir, 'e2e-03', 'e2e-03.json'),
    JSON.stringify({
      case: 'e2e-03',
      verdict: 'PARTIAL',
      notes: 'skipped some things',
      // Two gaps declared, five NOT_RUNs recorded: three have no cause named.
      extra: { notRunCount: 5, gaps: [{ id: 'declared', covers: 2 }] },
    }),
  )

  try {
    const report = buildGuiReport({ artifactsDir: dir })
    assert.equal(report.status, 'FAIL', 'an unexplained skip is not a soft partial')
    assert.equal(report.unexplainedNotRun.length, 1)
    assert.equal(report.unexplainedNotRun[0].notRunCount, 5)
    assert.equal(report.unexplainedNotRun[0].declaredCoverage, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
