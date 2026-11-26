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

const { parseCaseNames } = await import(
  path.join(ROOT, 'scripts/verify-install/ssh-jump-e2e.mjs')
)

/**
 * Real captured stdout from run 45790480314's main invocation, verbatim in shape.
 *
 * Two cases print to stderr, which `--nocapture` interleaves into the run: the
 * fault-injection case prints `SSH_JUMP_E2E_RESULT`, and the soak prints its round
 * banner. In both, libtest's `ok` then lands on the following line.
 */
const CAPTURED = [
  'running 12 tests',
  'test session::ssh::ssh_jump_e2e_tests::a_bastion_refusal_is_attributed_to_the_bastion ... ok',
  'test session::ssh::ssh_jump_e2e_tests::an_injected_fault_names_its_own_leg_and_no_more ... SSH_JUMP_E2E_RESULT scenario=healthy elapsed_ms=258',
  'ok',
  'test session::ssh::ssh_jump_e2e_tests::repeated_connect_and_disconnect_returns_to_a_clean_baseline ... running 12 connect/disconnect rounds',
  'ok',
  'test session::ssh::ssh_jump_e2e_tests::two_sessions_through_one_bastion_do_not_share_a_transport ... ok',
  '',
  'test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 513 filtered out; finished in 2.40s',
].join('\n')

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

  it('applies the same rule to the soak workflow', () => {
    /*
     * `ssh-soak.yml` runs the same harness with the same upload shape. It does set
     * `SSH_JUMP_E2E_REPORT`, so its artifact exists today — but `warn` is the setting
     * that let the PR-time job upload nothing for its entire history, and a soak report
     * nobody can read is the same defect one workflow over.
     */
    const soak = readFileSync(path.join(ROOT, '.github/workflows/ssh-soak.yml'), 'utf8')
    assert.match(soak, /SSH_JUMP_E2E_REPORT:\s*\S+/, 'the soak must name its report path')
    assert.match(soak, /if-no-files-found:\s*error/, 'a missing soak report must fail')
    assert.doesNotMatch(soak, /if-no-files-found:\s*warn/, 'warn hides a report that never wrote')
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

describe('the report lists every case that ran', () => {
  it('counts a case whose verdict landed on the next line', () => {
    /*
     * Measured on run 45790480314: the report listed 10 cases and the invocation said
     * `12 passed`. The two it dropped were the two that print — the fault-injection case
     * and the soak — so the under-listing fell exactly on the coverage a reader would go
     * looking for, and nothing in the report said it was short.
     */
    const cases = parseCaseNames(CAPTURED)
    assert.equal(cases.length, 4, `expected 4 cases, got ${cases.length}`)
    assert.deepEqual(
      cases.map(c => c.outcome),
      ['ok', 'ok', 'ok', 'ok'],
    )
  })

  it('keeps the name of a case whose output interrupted the line', () => {
    const cases = parseCaseNames(CAPTURED)
    const names = cases.map(c => c.name.split('::').pop())
    assert.ok(
      names.includes('an_injected_fault_names_its_own_leg_and_no_more'),
      'the fault-injection case must appear, not vanish behind its own output',
    )
    assert.ok(
      names.includes('repeated_connect_and_disconnect_returns_to_a_clean_baseline'),
      'the soak case must appear, not vanish behind its round banner',
    )
  })

  it('takes the count from the run, not from the summary line', () => {
    /*
     * The summary says 12 but the captured snippet has 4. Deriving the list from the
     * summary would hide a case that printed and then failed to be parsed — the exact
     * defect. The summary is only used elsewhere to decide pass/fail.
     */
    assert.equal(parseCaseNames(CAPTURED).length, 4)
  })

  it('does not invent a verdict for a truncated run', () => {
    const truncated = 'test session::ssh::ssh_jump_e2e_tests::some_case ... some output\n'
    const cases = parseCaseNames(truncated)
    assert.equal(cases.length, 1)
    // Named, but explicitly not ok: a case cut off mid-run must not read as a pass.
    assert.equal(cases[0].outcome, 'NO_VERDICT')
  })

  it('does not treat a FAILED case as ok just because the next line says ok', () => {
    // A real failure prints its verdict inline; the parser must not pair it with the
    // next case's verdict.
    const mixed = [
      'test session::ssh::ssh_jump_e2e_tests::a ... FAILED',
      'test session::ssh::ssh_jump_e2e_tests::b ... ok',
    ].join('\n')
    const cases = parseCaseNames(mixed)
    assert.deepEqual(
      cases.map(c => [c.name.split('::').pop(), c.outcome]),
      [
        ['a', 'FAILED'],
        ['b', 'ok'],
      ],
    )
  })
})
