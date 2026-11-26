/**
 * The SSH jump harness must fail the job when its verdict is FAIL.
 *
 * ## The defect this pins, measured on run 45758649504
 *
 * All three disconnect scenarios failed in CI, `finish('FAIL')` printed
 * `[ssh12] verdict: FAIL`, and the `Real SSH jump matrix` job went **green**. Only
 * `main().catch` set `process.exitCode`, so every verdict reached through the normal
 * flow was advisory — a matrix that records failures and lets them through is worse
 * than no matrix, because it reads as coverage.
 *
 * ## And the race that made it fail in the first place
 *
 * The matrix ran *before* the main cargo invocation. Each of its three scenarios then
 * started its own `cargo test` against an unbuilt `target/`; they contended for the
 * package-cache and build-directory locks and died with
 * `failed to run custom build command for gobject-sys`.
 *
 * Both are structural properties of the script, so both are asserted at the source.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = readFileSync(
  path.join(ROOT, 'scripts/verify-install/ssh-jump-e2e.mjs'),
  'utf8',
)

describe('the jump harness fails when it says FAIL', () => {
  it('sets a non-zero exit code for a FAIL verdict', () => {
    /*
     * The assertion is on the `finish` function body specifically: an exit code set
     * somewhere else (say, only in a scenario branch) would satisfy a whole-file grep
     * and still let the main FAIL path through.
     */
    const finishStart = HARNESS.indexOf('function finish(verdict, detail)')
    assert.ok(finishStart > -1, 'finish() must exist')
    const finishBody = HARNESS.slice(finishStart, HARNESS.indexOf('\n}', finishStart))
    assert.match(
      finishBody,
      /verdict === 'FAIL'[\s\S]*process\.exitCode = 1/,
      'finish() must set process.exitCode when the verdict is FAIL',
    )
  })

  it('does not fail the process for NOT_RUN', () => {
    // A platform without sshd is a missing precondition, which the CI job's own
    // contract treats as distinct from a failure.
    const finishStart = HARNESS.indexOf('function finish(verdict, detail)')
    const finishBody = HARNESS.slice(finishStart, HARNESS.indexOf('\n}', finishStart))
    assert.doesNotMatch(
      finishBody,
      /verdict !== 'PASS'[\s\S]*process\.exitCode = 1/,
      'NOT_RUN must stay non-fatal',
    )
  })
})

describe('the disconnect matrix runs on a built tree', () => {
  it('starts after the main cargo invocation', () => {
    /*
     * Ordering is the fix for the build race. `waitForTests(cargo, ...)` is the main
     * invocation; the matrix's `report.disconnectMatrix = []` must come after it.
     */
    const mainRun = HARNESS.indexOf('const result = await waitForTests(cargo,')
    const matrix = HARNESS.indexOf('report.disconnectMatrix = []')
    assert.ok(mainRun > -1, 'the main cargo invocation must exist')
    assert.ok(matrix > -1, 'the matrix must exist')
    assert.ok(
      matrix > mainRun,
      'the matrix must run after the main build, or its scenarios race the compiler',
    )
  })

  it('a failed scenario is checked before the generic PASS branch', () => {
    const matrixCheck = HARNESS.indexOf('report.disconnectMatrix.some(entry => !entry.passed)')
    const passBranch = HARNESS.lastIndexOf("finish('PASS')")
    assert.ok(matrixCheck > -1, 'the matrix must be part of the verdict')
    assert.ok(
      matrixCheck < passBranch,
      'the scenario check must precede the PASS branch, or a failed scenario is ignored',
    )
  })
})
