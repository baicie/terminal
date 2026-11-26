/**
 * The jump matrix's report has to be produced, and its result has to be readable.
 *
 * ## The defect this pins, measured on run 45786015950
 *
 * The `Real SSH jump matrix` job went green. Two things about that green were not
 * verifiable from anything it left behind:
 *
 * 1. **No report was ever written.** `finish()` writes JSON only when
 *    `SSH_JUMP_E2E_REPORT` names a path. `ci.yml` has uploaded
 *    `/tmp/ssh-jump-report.json` since the step was added and never set that variable,
 *    so every run logged `No files were found with the provided path` and carried on.
 *    `if-no-files-found: warn` is what made that a note instead of a failure.
 * 2. **The matrix's per-scenario results never reached the log.** `runScenario` printed
 *    the cargo output only when a scenario failed; on a pass it printed nothing. The
 *    single scenario line in 555 lines of job log was the *main* invocation's own
 *    `SSH_JUMP_E2E_RESULT scenario=healthy` — a line the matrix does not produce.
 *
 * So "the three injected scenarios ran and passed" rested on the harness's exit code
 * alone. That is the same shape as the false green this harness was fixed for one round
 * earlier: readable as coverage, checkable from nothing.
 *
 * ## Why source-level assertions
 *
 * Both facts are properties of the workflow file and of the printing branch, and neither
 * is reachable from a unit test without standing up sshd. They are asserted where they
 * live, and each one is written so that removing the fix turns it red.
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
const WORKFLOW = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')

/** The `real-ssh-jump` job's text, from its key to the next top-level job. */
function realSshJumpJob(source) {
  const start = source.indexOf('\n  real-ssh-jump:')
  assert.ok(start > -1, 'the real-ssh-jump job must exist')
  const rest = source.slice(start + 1)
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('the matrix report is written and uploaded', () => {
  it('names a report path when it runs the harness', () => {
    const job = realSshJumpJob(WORKFLOW)
    /*
     * The assertion is on the run step's env, not on the file as a whole: the upload
     * step already mentions the path, so a whole-file grep would pass on the broken
     * workflow — which is exactly the state that shipped.
     */
    const runStep = job.slice(job.indexOf('- name: Run the real two-hop matrix'))
    const stepEnd = runStep.indexOf('\n      - ')
    const block = stepEnd === -1 ? runStep : runStep.slice(0, stepEnd)
    assert.match(
      block,
      /SSH_JUMP_E2E_REPORT:\s*\S+/,
      'the run step must set SSH_JUMP_E2E_REPORT, or finish() writes no file',
    )
  })

  it('fails the job when the report is missing', () => {
    const job = realSshJumpJob(WORKFLOW)
    /*
     * `warn` is the default and is why the missing file was invisible for the job's
     * whole history. The upload has to be able to fail.
     */
    assert.match(
      job,
      /if-no-files-found:\s*error/,
      'a missing report must fail the upload, not warn and continue',
    )
    assert.doesNotMatch(
      job,
      /if-no-files-found:\s*warn/,
      'warn turns a report that was never written into a green job',
    )
  })

  it('still uploads on failure', () => {
    // A failing matrix is when its report matters most; `always()` must stay.
    const job = realSshJumpJob(WORKFLOW)
    const upload = job.slice(job.indexOf('Upload the matrix report'))
    assert.match(
      upload,
      /if:\s*always\(\)/,
      'the report must be uploaded when the matrix fails, not only when it passes',
    )
  })
})

describe('a passing scenario says so in the log', () => {
  it('prints a line per scenario, not only failures', () => {
    /*
     * Anchor on the branch itself: the `else` belonging to `if (!ok)`. A print placed
     * anywhere else (say, in the report push) would satisfy a whole-file grep while
     * leaving a green log silent.
     */
    const failureBranch = HARNESS.indexOf('if (!ok) {')
    assert.ok(failureBranch > -1, 'the failure branch must exist')
    const after = HARNESS.slice(failureBranch, failureBranch + 2500)
    const elseIndex = after.indexOf('} else {')
    assert.ok(elseIndex > -1, 'a passing branch must exist alongside the failure branch')
    const passBranch = after.slice(elseIndex, elseIndex + 1200)
    assert.match(
      passBranch,
      /process\.stdout\.write\(/,
      'a passing scenario must print its own line, or the log cannot show it ran',
    )
  })

  it('reports the injection counters with the pass', () => {
    /*
     * The counters are the injection's own proof: a `reset` scenario reporting `cut: 0`
     * never interrupted anything, and its assertion would then have passed for a reason
     * unrelated to the fault. Printing them is what lets a reader check that.
     */
    const passStart = HARNESS.indexOf('} else {', HARNESS.indexOf('if (!ok) {'))
    const passBranch = HARNESS.slice(passStart, passStart + 1600)
    assert.match(passBranch, /proxy\.stats\.accepted/, 'the pass line must carry `accepted`')
    assert.match(passBranch, /proxy\.stats\.cut/, 'the pass line must carry `cut`')
  })
})
