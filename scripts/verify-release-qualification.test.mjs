// The release gate's contract.
//
// Every case here is a release that must **not** happen. The one that matters most is
// the "green run of a different commit" case: that is how an untested last-minute
// commit ships behind a passing badge.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RELEASE_MODES,
  REQUIRED_RELEASE_CHECKS,
  judgeRelease,
} from './verify-release-qualification.mjs'

const COMMIT = 'a'.repeat(40)

/** Facts for a release that passes every rule. */
function goodFacts(overrides = {}) {
  const checks = Object.fromEntries(
    REQUIRED_RELEASE_CHECKS.map(name => [
      name,
      {
        conclusion: 'success',
        headSha: COMMIT,
        // Provenance is mandatory: a check without a resolved workflow path is refused,
        // because app id and name are not proof of source.
        workflowPath: name.includes('GUI') || name === 'Driver isolation gate'
          ? '.github/workflows/native-gui-e2e.yml'
          : '.github/workflows/ci.yml',
      },
    ]),
  )
  return {
    commit: COMMIT,
    tag: 'v1.2.3',
    tagCommit: COMMIT,
    mode: 'updater-signed',
    checks,
    evidence: {
      qualificationPassed: true,
      problemCount: 0,
      missingScenarios: [],
      notPassed: [],
    },
    signing: { updaterKeyPresent: true, notarized: false },
    ...overrides,
  }
}

test('a fully qualified release passes', () => {
  const { ok, problems } = judgeRelease(goodFacts())
  assert.equal(ok, true, JSON.stringify(problems))
})

test('a check that ran on a different commit is rejected', () => {
  // The failure this exists for: CI green on an earlier commit, two more commits
  // pushed, tag placed on the newest one. The badge is real; it just describes
  // different code.
  const facts = goodFacts()
  facts.checks['Rust quality'] = { conclusion: 'success', headSha: 'b'.repeat(40) }
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'check-wrong-sha'), JSON.stringify(problems))
})

test('a missing required check is rejected', () => {
  const facts = goodFacts()
  delete facts.checks['Tauri build (windows-latest)']
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'check-missing'))
})

test('a failed or cancelled check is rejected', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'neutral', null]) {
    const facts = goodFacts()
    facts.checks['Rust quality'] = { conclusion, headSha: COMMIT }
    const { ok } = judgeRelease(facts)
    assert.equal(ok, false, `conclusion ${JSON.stringify(conclusion)} must not pass`)
  }
})

test('a tag that does not resolve to the commit is rejected', () => {
  const { ok, problems } = judgeRelease(goodFacts({ tagCommit: 'c'.repeat(40) }))
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'tag-not-on-commit'))
})

test('a malformed tag or commit is rejected', () => {
  assert.equal(judgeRelease(goodFacts({ tag: 'release-1' })).ok, false)
  assert.equal(judgeRelease(goodFacts({ commit: 'abc' })).ok, false)
})

test('evidence that does not describe this commit is rejected', () => {
  const facts = goodFacts()
  facts.evidence = { qualificationPassed: false, problemCount: 7, missingScenarios: [], notPassed: [] }
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'evidence-not-qualified'))
})

test('a missing scenario is rejected even when the gate passed', () => {
  // The gate can pass and still cover less than the release claims, if a scenario was
  // dropped from the contract. Both are checked.
  const facts = goodFacts()
  facts.evidence.missingScenarios = ['release-ssh-matrix']
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'evidence-missing-scenarios'))
})

test('a scenario recorded NOT_RUN is rejected', () => {
  const facts = goodFacts()
  facts.evidence.notPassed = [{ name: 'cold-start', verdict: 'NOT_RUN' }]
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'evidence-not-passed'))
})

test('an unknown mode is rejected rather than treated as the loosest one', () => {
  const { ok, problems } = judgeRelease(goodFacts({ mode: 'whatever' }))
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'mode-unknown'))
})

test('a signed mode without a key is rejected', () => {
  const facts = goodFacts({ signing: { updaterKeyPresent: false, notarized: false } })
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'mode-needs-updater-key'))
})

test('fully-signed without notarization is rejected', () => {
  const facts = goodFacts({ mode: 'fully-signed' })
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'mode-needs-notarization'))
})

test('an unsigned mode with a signing key present is rejected', () => {
  // The "do not silently downgrade" rule, in the other direction: shipping
  // `unsigned-qa` while a key sits in the environment means the artefacts and the
  // label disagree about what the user is getting.
  const facts = goodFacts({ mode: 'unsigned-qa' })
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(p => p.code === 'mode-mismatch'))
})

test('unsigned-qa passes when it really is unsigned', () => {
  const facts = goodFacts({
    mode: 'unsigned-qa',
    signing: { updaterKeyPresent: false, notarized: false },
  })
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, true, JSON.stringify(problems))
})

test('the three modes state what they promise', () => {
  assert.equal(RELEASE_MODES['unsigned-qa'].requiresSignatures, false)
  assert.equal(RELEASE_MODES['updater-signed'].requiresSignatures, true)
  assert.equal(RELEASE_MODES['fully-signed'].requiresNotarization, true)
})

test('the required check list includes the aggregate gate', () => {
  // `required` is what branch protection enforces on the merge; a release must not be
  // allowed to skip the thing a merge could not.
  assert.ok(REQUIRED_RELEASE_CHECKS.includes('required'))
})

test('a fact-collection failure is reported separately from a failed check', () => {
  // T12: the two send a reader to different places. "Checks unreadable" means look at
  // GitHub's availability or the token; "check-not-success" means look at CI. Reporting
  // both as the same code would erase that distinction exactly when it matters.
  const facts = goodFacts({ checks: {}, checksError: 'check-run page 1 could not be read' })
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(
    problems.some(p => p.code === 'checks-unreadable'),
    JSON.stringify(problems),
  )
  // And it does not pretend the checks passed: every required name is also missing.
  assert.ok(problems.some(p => p.code === 'check-missing'))
})

test('a check from the wrong workflow is refused even though its name matches', () => {
  // The spoof: another workflow in this repository publishes `Rust quality`. App id is
  // the same for every workflow, so only the resolved workflow path distinguishes it.
  const facts = goodFacts()
  facts.checks['Rust quality'] = {
    conclusion: 'success',
    headSha: COMMIT,
    workflowPath: '.github/workflows/pretend-green.yml',
  }
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'check-wrong-workflow'), JSON.stringify(problems))
})

test('a check whose workflow could not be resolved is refused', () => {
  // `workflowPath: null` means "could not determine", which is not permission.
  const facts = goodFacts()
  facts.checks['Rust quality'] = { conclusion: 'success', headSha: COMMIT, workflowPath: null }
  const { problems } = judgeRelease(facts)
  assert.ok(problems.some(problem => problem.code === 'check-wrong-workflow'))
})

test('the GUI gate is required and its absence names the PR-evidence reason', () => {
  const facts = goodFacts()
  delete facts.checks['macOS GUI E2E']
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  const problem = problems.find(entry => entry.message.includes('macOS GUI E2E'))
  assert.ok(problem, JSON.stringify(problems))
  assert.equal(problem.code, 'check-missing-pr-evidence')
  assert.match(problem.message, /PR-time run/)
})

test('the GUI gate present and green lets qualification proceed', () => {
  const facts = goodFacts()
  facts.checks['Driver isolation gate'] = {
    conclusion: 'success',
    headSha: COMMIT,
    workflowPath: '.github/workflows/native-gui-e2e.yml',
  }
  facts.checks['macOS GUI E2E'] = {
    conclusion: 'success',
    headSha: COMMIT,
    workflowPath: '.github/workflows/native-gui-e2e.yml',
  }
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, true, JSON.stringify(problems, null, 2))
})

test('a red GUI gate blocks the release', () => {
  const facts = goodFacts()
  facts.checks['Driver isolation gate'] = {
    conclusion: 'success',
    headSha: COMMIT,
    workflowPath: '.github/workflows/native-gui-e2e.yml',
  }
  facts.checks['macOS GUI E2E'] = {
    conclusion: 'failure',
    headSha: COMMIT,
    workflowPath: '.github/workflows/native-gui-e2e.yml',
  }
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'check-not-success'))
})

test('a check with no provenance at all is refused, not skipped', () => {
  // The hole an earlier version had: `entry.workflowPath !== undefined && …` meant a
  // facts file with no provenance passed with no verification. Provenance is not
  // optional, because a check's name is data a workflow chooses.
  const facts = goodFacts()
  facts.checks['Rust quality'] = { conclusion: 'success', headSha: COMMIT }
  const { ok, problems } = judgeRelease(facts)
  assert.equal(ok, false)
  const problem = problems.find(entry => entry.code === 'check-wrong-workflow')
  assert.ok(problem, JSON.stringify(problems))
  assert.match(problem.message, /<unresolved>/)
})

test('every required check is provenance-verified against its owner', () => {
  // The whole set, not just one: a single unprotected name is enough to spoof.
  const facts = goodFacts()
  for (const name of REQUIRED_RELEASE_CHECKS) {
    facts.checks[name] = {
      conclusion: 'success',
      headSha: COMMIT,
      workflowPath: '.github/workflows/pretend-green.yml',
    }
  }
  const { problems } = judgeRelease(facts)
  const wrong = problems.filter(problem => problem.code === 'check-wrong-workflow')
  assert.equal(wrong.length, REQUIRED_RELEASE_CHECKS.length, JSON.stringify(problems))
})
