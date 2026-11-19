// The GUI layer report: per-run counts, never a history-wide sum, never a stale verdict.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildGuiReport, summariseGuiArtifacts } from './gui-e2e-report.mjs'

function artifacts(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gui-report-'))
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(root, name)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents))
  }
  return root
}

function wdio(passed, failed, skipped = 0) {
  return { state: { passed, failed, skipped } }
}

test('a clean run sums to PASS', () => {
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(6, 0),
    'json/wdio-0-1-1000000000060.json': wdio(3, 0),
    'run-summary.json': { verdict: 'PASS', exitCode: 0 },
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'Linux' })
  assert.equal(report.status, 'PASS')
  assert.equal(report.total, 9)
  assert.equal(report.failed, 0)
})

test('a failing case makes the layer FAIL even when the summary says PASS', () => {
  // The measured conflict: a stale summary claiming PASS over a window with failures.
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(2, 3),
    'run-summary.json': { verdict: 'PASS', exitCode: 0, ranAt: '2026-01-01T00:00:00Z' },
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'Windows' })
  assert.equal(report.status, 'FAIL')
  assert.equal(report.failed, 3)
  assert.ok(report.verdictConflict, 'the disagreement must be surfaced, not resolved silently')
  assert.match(report.verdictConflict, /predates this window/)
})

test('older runs are excluded, so the count describes one run', () => {
  // The committed artifacts hold 134 files across many runs. Summing all of them gave
  // 590 cases / 63 failures, which describes no run that ever happened.
  const root = artifacts({
    // 3 hours earlier: outside the one-hour window that groups a single invocation.
    'json/wdio-0-0-1000000000000.json': wdio(50, 50),
    'json/wdio-0-0-1000010800000.json': wdio(4, 0),
    'json/wdio-0-1-1000010800060.json': wdio(2, 0),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'macOS' })
  assert.equal(report.total, 6, 'the newer window only')
  assert.equal(report.failed, 0)
  assert.equal(report.runWindow.excludedOlderFiles, 1)
})

test('no wdio output at all is NOT_RUN, never a clean zero', () => {
  const root = artifacts({ 'run-summary.json': { verdict: 'FAIL', exitCode: 1 } })
  const report = buildGuiReport({ artifactsDir: root })
  assert.equal(report.status, 'NOT_RUN')
  assert.equal(report.notRun, 1)
  assert.match(report.reason, /no wdio output/)
})

test('one unreadable spec file makes the layer INCOMPLETE, not NOT_RUN', () => {
  // A 0-byte `wdio-*.json` is what a crashed spec leaves behind. The first version
  // returned NOT_RUN for the whole layer, discarding the readable specs beside it.
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'json/wdio-0-1-1000000000060.json': '',
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'macOS' })
  assert.equal(report.status, 'INCOMPLETE')
  assert.equal(report.total, 5, 'the readable counts are still reported')
  assert.equal(report.corruptFiles.length, 1)
  assert.match(report.reason, /unreadable/)
})

test('every file unreadable is NOT_RUN with the reason naming that', () => {
  const root = artifacts({ 'json/wdio-0-0-1000000000000.json': '' })
  const report = buildGuiReport({ artifactsDir: root })
  assert.equal(report.status, 'NOT_RUN')
  assert.match(report.reason, /every wdio file was unreadable/)
})

test('a truncated-but-parseable state block is summed, and missing fields are zero', () => {
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': { state: { passed: 2 } },
    'json/wdio-0-1-1000000000060.json': wdio(1, 0, 4),
  })
  const report = buildGuiReport({ artifactsDir: root })
  assert.equal(report.passed, 3)
  assert.equal(report.skipped, 4)
  assert.equal(report.total, 7)
  assert.equal(report.status, 'PASS')
})

test('files without a timestamp are treated as one run rather than excluded', () => {
  // A hand-written fixture (or an older wdio naming scheme) must not vanish.
  const root = artifacts({
    'json/wdio-0-0-darwin.json': wdio(3, 0),
  })
  const report = buildGuiReport({ artifactsDir: root })
  assert.equal(report.total, 3)
  assert.equal(report.runWindow, null, 'no window means no exclusion was applied')
})

test('summariseGuiArtifacts reports how many files it excluded', () => {
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(1, 0),
    'json/wdio-0-0-1000009000000.json': wdio(1, 0),
  })
  const counts = summariseGuiArtifacts(root)
  assert.equal(counts.specs, 1)
  assert.equal(counts.excluded, 1)
})

// ---------------------------------------------------------------------------
// The cases' own verdicts. wdio counts only say whether a case threw, and a spec
// that records NOT_RUN and returns normally produces `failed: 0` — which is how a
// green job shipped with the snippet dock not opening on Linux (run 44230712100).
// ---------------------------------------------------------------------------

/** The exact shape `writeEvidence` produces for one case. */
function caseEvidence(caseId, { verdict, notRunCount = 0, notRun = null, gaps = null, failures = [] }) {
  return {
    case: caseId,
    verdict,
    recordedAt: '2026-01-01T00:00:00Z',
    notes: '',
    extra: {
      failures,
      ...(notRun === null ? { notRunCount } : { notRun }),
      ...(gaps === null ? {} : { gaps }),
    },
  }
}

function artifactsWithCases(files) {
  const flat = {}
  for (const [name, contents] of Object.entries(files)) {
    if (name.startsWith('cases/')) {
      const caseId = name.slice('cases/'.length)
      flat[`${caseId}/${caseId}.json`] = contents
    } else {
      flat[name] = contents
    }
  }
  return artifacts(flat)
}

test('a case that recorded FAIL fails the layer even though no case threw', () => {
  // The measured shape: wdio says 5 passed / 0 failed, the case says FAIL.
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'cases/e2e-04': caseEvidence('e2e-04', {
      verdict: 'FAIL',
      failures: [{ title: 'a required dock did not open', error: 'no palette row' }],
    }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'Linux' })
  assert.equal(report.status, 'FAIL', 'a case-level FAIL must not be reported as a passing layer')
  assert.deepEqual(report.failedCases, ['e2e-04'])
})

test('a PARTIAL over a declared gap does not fail, and is never counted as a pass', () => {
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'cases/e2e-03': caseEvidence('e2e-03', {
      verdict: 'PARTIAL',
      notRunCount: 1,
      gaps: [{ id: 'no-ssh-fixture', reason: 'no sshd', needs: 'GUI_E2E_SSH_PORT' }],
    }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'Linux' })
  assert.equal(report.status, 'PASS')
  assert.deepEqual(report.unexplainedNotRun, [])
  assert.deepEqual(
    report.partialCases,
    ['e2e-03'],
    'the gap must still be visible, not absorbed into passed',
  )
  assert.deepEqual(
    report.cases,
    [{ case: 'e2e-03', verdict: 'PARTIAL', notRunCount: 1 }],
    'the NOT_RUN count must survive into the report',
  )
})

test('a NOT_RUN beyond the declared gaps fails the layer', () => {
  // This is the Linux defect expressed as a unit: four NOT_RUNs, one declared gap.
  // The extra three came from a surface that should have worked.
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'cases/e2e-04': caseEvidence('e2e-04', {
      verdict: 'PARTIAL',
      notRunCount: 4,
      gaps: [{ id: 'real-model-answer', reason: 'no endpoint', needs: 'a model endpoint' }],
    }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'Linux' })
  assert.equal(report.status, 'FAIL')
  assert.deepEqual(report.unexplainedNotRun, [
    { case: 'e2e-04', notRunCount: 4, declaredCoverage: 1 },
  ])
})

test('a case with no declared gaps and any NOT_RUN fails', () => {
  // The default must be strict: a spec that forgets to declare its gaps cannot coast.
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'cases/e2e-04': caseEvidence('e2e-04', { verdict: 'PARTIAL', notRunCount: 3 }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'darwin' })
  assert.equal(report.status, 'FAIL')
})

test('all-green cases with no gaps report PASS and name no partial case', () => {
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'cases/e2e-04': caseEvidence('e2e-04', { verdict: 'PASS' }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'darwin' })
  assert.equal(report.status, 'PASS')
  assert.deepEqual(report.partialCases, [])
  assert.deepEqual(report.unexplainedNotRun, [])
})

// ---------------------------------------------------------------------------
// The exit status. `main()` used to return 0 unconditionally, so a report that said
// `status: "FAIL"` still left the job green — the third way the same job described a
// broken run as a passing one.
// ---------------------------------------------------------------------------

test('main() exits 1 when the report status is FAIL', async () => {
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'cases/e2e-04': caseEvidence('e2e-04', { verdict: 'FAIL', failures: [{ title: 'x', error: 'y' }] }),
  })
  const out = path.join(root, 'out.json')
  const { main } = await import('./gui-e2e-report.mjs')
  assert.equal(main(['--artifacts', root, '--out', out]), 1)
  // The file is still written, so the artifact upload keeps the diagnosis.
  const written = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(written.status, 'FAIL')
})

test('main() exits 0 for PASS, and for NOT_RUN where nothing usable ran', async () => {
  const { main } = await import('./gui-e2e-report.mjs')
  const passRoot = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(5, 0),
    'cases/e2e-04': caseEvidence('e2e-04', { verdict: 'PASS' }),
  })
  assert.equal(main(['--artifacts', passRoot]), 0)
  // An empty artifacts dir is NOT_RUN: the runner step is what failed to produce
  // output, and failing here too would report one problem twice.
  const emptyRoot = mkdtempSync(path.join(os.tmpdir(), 'gui-report-empty-'))
  assert.equal(main(['--artifacts', emptyRoot]), 0)
})

test('the Linux artifact that failed the layer is now explained', () => {
  // Not a synthetic fixture: this is the shape of the real
  // `gui-e2e-evidence-linux-44268976548` run, which failed `Summarise the GUI layer`
  // on `e2e-03` (6 NOT_RUNs) after the spec's own cases all passed. The gap
  // declaration must cover *all* six, or the layer fails for a reason nobody can act
  // on — the same "unexplained" bucket that is supposed to mean "a surface broke".
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(25, 0),
    'cases/e2e-01': caseEvidence('e2e-01', { verdict: 'PARTIAL' }),
    'cases/e2e-02': caseEvidence('e2e-02', { verdict: 'PASS' }),
    'cases/e2e-03': caseEvidence('e2e-03', {
      verdict: 'PARTIAL',
      notRunCount: 6,
      gaps: [
        { id: 'no-connected-sftp-session', reason: 'no connected host', needs: 'a connecting case', covers: 6 },
      ],
    }),
    'cases/e2e-04': caseEvidence('e2e-04', {
      verdict: 'PARTIAL',
      notRunCount: 3,
      gaps: [
        { id: 'a', reason: 'r', needs: 'n' },
        { id: 'b', reason: 'r', needs: 'n' },
        { id: 'c', reason: 'r', needs: 'n' },
      ],
    }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'Linux' })
  assert.equal(
    report.status,
    'PASS',
    'six NOT_RUNs under a declared gap are a documented environment limit, not a failure',
  )
  assert.deepEqual(report.partialCases.sort(), ['e2e-01', 'e2e-03', 'e2e-04'])
  assert.deepEqual(
    report.unexplainedNotRun,
    [],
    'declaring the gap must clear the unexplained bucket for that case',
  )
})

// ---------------------------------------------------------------------------
// `e2e-01` writes `extra.notRun` (an array of reasons), `e2e-04` writes
// `extra.notRunCount` (a number). The reader knew only the second, so every skip in
// e2e-01 was invisible to the declared-gap rule — including its launch-regression
// path. Measured before the fix: a PARTIAL e2e-01 with one NOT_RUN produced
// `status: PASS, unexplainedNotRun: []`.
// ---------------------------------------------------------------------------

test('a case that reports NOT_RUN as an array of reasons is still checked', () => {
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(6, 0),
    'cases/e2e-01': caseEvidence('e2e-01', {
      verdict: 'PARTIAL',
      // No `notRunCount` at all — the shape e2e-01 actually writes.
      notRun: ['no local terminal tab exists in this run'],
      localTab: { ok: false, tabs: 0 },
    }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'linux' })
  assert.equal(
    report.status,
    'FAIL',
    'a launch regression recorded as an array must not be invisible to the layer',
  )
  assert.deepEqual(report.unexplainedNotRun, [
    { case: 'e2e-01', notRunCount: 1, declaredCoverage: 0 },
  ])
})

test('the array form honours a declared gap the same way the number does', () => {
  const root = artifactsWithCases({
    'json/wdio-0-0-1000000000000.json': wdio(6, 0),
    'cases/e2e-01': caseEvidence('e2e-01', {
      verdict: 'PARTIAL',
      notRun: ['launch-state case: this run did not start from a fresh profile'],
      gaps: [
        { id: 'shared-app-profile', reason: 'shared app process', needs: 'per-spec launch', covers: 1 },
      ],
    }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'linux' })
  assert.equal(report.status, 'PASS', 'a declared gap must clear it whichever shape reported it')
  assert.deepEqual(report.unexplainedNotRun, [])
  assert.deepEqual(report.cases, [{ case: 'e2e-01', verdict: 'PARTIAL', notRunCount: 1 }])
})

test('case evidence that exists but cannot be parsed is INCOMPLETE, not a pass', () => {
  // A spec writes its verdict in `after()`. A crash there leaves a case directory
  // with a truncated or 0-byte file — measured before this: `status: PASS` with
  // `cases: []`, indistinguishable from a spec that ran nothing.
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(6, 0),
    'e2e-04/e2e-04.json': '{"case":"e2e-04","verdict":',
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'linux' })
  assert.equal(report.status, 'INCOMPLETE')
  assert.deepEqual(report.unreadableCaseEvidence, ['e2e-04'])
})

test('a directory that simply has no evidence file is not counted as unreadable', () => {
  // `json/` holds the wdio files and `screens/` lives inside each case. Treating any
  // directory without a matching .json as corrupt made every ordinary run INCOMPLETE.
  const root = artifacts({
    'json/wdio-0-0-1000000000000.json': wdio(6, 0),
    'cases/e2e-04': caseEvidence('e2e-04', { verdict: 'PASS' }),
  })
  const report = buildGuiReport({ artifactsDir: root, platform: 'linux' })
  assert.equal(report.status, 'PASS')
  assert.deepEqual(report.unreadableCaseEvidence, [])
})
