/**
 * Decide whether a pull request may be merged, from its *latest* head.
 *
 * ## Why this exists
 *
 * Ruleset `27354680` used to carry a `required_status_checks` rule with one context,
 * `required`. It no longer does: on 2026-11-20 the repository owner directed that the
 * pre-merge CI gate be removed, so that PRs may be merged without waiting for CI
 * (the "OpsWeave 0.0.1 平台发行版硬化" flow). `gh api repos/baicie/terminal/rulesets/27354680`
 * shows only `deletion`, `non_fast_forward` and `pull_request` — that is the authorized
 * state, and this tool does not undo it.
 *
 * What the ruleset still enforces is the part that cannot be delegated to memory:
 *
 *   deletion          — `main` cannot be deleted
 *   non_fast_forward  — history cannot be force-pushed
 *   pull_request      — every change lands through a PR
 *
 * What it no longer enforces is "the checks passed". Between the removal and this
 * file, that gap was not theoretical: **PR #128 and #129 both merged with
 * `Frontend quality`, `required` and all three GUI jobs red**, and `main` was left
 * unable to pass its own bundle gate (653.63 KB against a 653.50 KB ceiling). Two
 * merges, no gate, and nobody noticed until the next task looked.
 *
 * So the check moves here, where its rules are visible, testable and re-runnable.
 *
 * ## The three traps it refuses
 *
 *   1. **A stale PASS is not a PASS.** The checks are read for the exact head SHA.
 *      A green run from three commits ago says nothing about what is being merged.
 *   2. **A pending check is not a pass.** `bucket: 'pending'` means the answer is not
 *      in yet; merging then is merging with no gate, except it *looks* gated.
 *   3. **A check that can be absent is not made required.** `native-gui-e2e.yml` is
 *      `paths:`-filtered, so a docs-only PR produces no such run. Demanding it would
 *      leave that PR pending forever — the exact defect the first ruleset iteration
 *      had (`docs/ci/main-ruleset.md §4.1`). Absence is therefore judged against the
 *      path-filtered allowlist, never against a hard-coded list of "expected" names.
 *
 * Usage:
 *   node scripts/check-merge-gate.mjs --pr 123 [--json]
 *
 * Exit codes: 0 = may merge, 1 = blocked.
 */

/** Checks whose absence from a PR is legitimate, matched by name prefix. */
export const PATH_FILTERED_CHECKS = [
  // `native-gui-e2e.yml` triggers on 19 UI paths; a docs-only PR never runs it.
  'macOS GUI E2E',
  'Windows GUI E2E',
  'Linux GUI E2E',
  'Driver isolation gate',
]

/**
 * The verdict, from facts already gathered.
 *
 * Split from the transport for one reason: every rule above is a decision about data,
 * and a decision buried in `execFileSync` calls can only be tested by merging a real
 * PR. This function is pure, so `check-merge-gate.test.mjs` can assert each trap with
 * a literal fixture — including the stale-head and cancelled cases that are hard to
 * reproduce live.
 *
 * `pr` is the subset of `gh pr view` this reads; `checks` is `gh pr checks --json`
 * (each `{name, state, bucket}`).
 */
export function decideMerge({ pr, checks }) {
  const problems = []
  const byBucket = bucket => checks.filter(check => check.bucket === bucket)

  const failing = byBucket('fail')
  const pending = byBucket('pending')
  const passing = byBucket('pass')
  const skipped = byBucket('skipping')
  /*
   * A cancelled check has `bucket: 'fail'` and `state: 'CANCELLED'`. Counting it under
   * both would double-report it; it is separated so the message can say *why* it is not
   * a pass. An unfinished check is not a passed one.
   */
  const cancelled = checks.filter(check => /CANCEL/i.test(check.state ?? ''))
  const failedNotCancelled = failing.filter(check => !cancelled.includes(check))

  const isPathFiltered = name => PATH_FILTERED_CHECKS.some(prefix => name.startsWith(prefix))
  const unexpectedSkips = skipped.filter(check => !isPathFiltered(check.name))

  if (pr.state !== 'OPEN') problems.push(`the PR is ${pr.state}, not OPEN`)
  if (pr.isDraft) problems.push('the PR is a draft')
  if (pr.mergeable === 'CONFLICTING') problems.push('the PR has merge conflicts')

  if (failedNotCancelled.length > 0) {
    problems.push(
      `${failedNotCancelled.length} check(s) failed: ${failedNotCancelled.map(c => c.name).join(', ')}`,
    )
  }
  // Trap 2, named in the output so a held gate is never mistaken for a broken one.
  if (pending.length > 0) {
    problems.push(
      `${pending.length} check(s) still running: ${pending.map(c => c.name).join(', ')} — ` +
        'ask again when they finish',
    )
  }
  if (cancelled.length > 0) {
    problems.push(
      `${cancelled.length} check(s) cancelled (an unfinished check is not a passed one): ` +
        cancelled.map(c => c.name).join(', '),
    )
  }
  // Trap 3 from the other side: a skip on a job that was supposed to run is not a pass.
  if (unexpectedSkips.length > 0) {
    problems.push(
      `check(s) skipped unexpectedly: ${unexpectedSkips.map(c => c.name).join(', ')} — ` +
        'a skipped gate is not a green gate',
    )
  }
  /*
   * No checks at all is a distinct state from "all checks passed". It means CI never
   * ran — a new branch, a broken workflow trigger, or a PR opened before the workflow
   * existed. Every one of those is a reason not to call the PR verified.
   */
  if (checks.length === 0) {
    problems.push('no checks reported on this head — CI never started for this branch')
  }

  return {
    verdict: problems.length === 0 ? 'MAY_MERGE' : 'BLOCKED',
    headSha: pr.headRefOid ?? null,
    counts: {
      pass: passing.length,
      fail: failedNotCancelled.length,
      pending: pending.length,
      skipped: skipped.length,
      cancelled: cancelled.length,
    },
    problems,
  }
}

/**
 * The tool's own statement of what it does not cover.
 *
 * Emitted in every report because it is the one thing a reader must not infer: a
 * `MAY_MERGE` says the checks that exist have finished and succeeded, not that the
 * product works. Native GUI coverage is partial by design and the real model
 * endpoints, OS keychains and signed release paths remain `BLOCKED_EXTERNAL`.
 */
export const GATE_SCOPE =
  'Checks only. A green verdict here does not mean the GUI suite, real model endpoints, ' +
  'or a signed release were exercised — see docs/design/terminal-next/15-daily-driver-matrix.md.'
