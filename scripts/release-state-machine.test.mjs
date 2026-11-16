// T13 — the release order, and what a dry-run of it proves.
//
// The previous suite passed `alreadyPublished: true` by hand to reach the channel
// steps, which hid the fact that the **default** path never got there:
//
//   simulate({})  ->  skipped: verify-downloadable, verify-manifest, switch-channel
//
// Publication is now a state transition, so `simulate({})` is the successful release
// and every failure injection is measured against it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  RELEASE_STEPS,
  checkOrdering,
  compareWithWorkflow,
  simulate,
} from './release-state-machine.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

test('the model order is valid', () => {
  assert.deepEqual(checkOrdering(), [])
})

test('the default success path reaches the channel switch', () => {
  // This is the assertion the old implementation failed. A success that never
  // advertises itself is not a release.
  const result = simulate({})
  assert.equal(result.ok, true)
  assert.equal(result.published, true, 'publish must set the published state')
  assert.equal(result.channelWritten, true)
  assert.equal(result.channelState, 'written')
  assert.deepEqual(result.skipped, [], 'a successful release skips nothing')
  assert.equal(result.ran[result.ran.length - 1], 'switch-channel')
})

test('the full chain runs in the documented order', () => {
  assert.deepEqual(
    simulate({}).ran,
    [
      'validate-metadata',
      'verify-evidence',
      'collect-checks',
      'judge-qualification',
      'create-draft',
      'build-artifacts',
      'attach-assets',
      'publish',
      'verify-downloadable',
      'verify-manifest',
      'switch-channel',
    ],
  )
})

test('a missing publish transition is a model bug', () => {
  // Without `publishes: true` the state never advances and the channel is unreachable —
  // exactly the old defect, now reported instead of silently accepted.
  const broken = RELEASE_STEPS.map(step => (step.id === 'publish' ? { ...step, publishes: false } : step))
  const problems = checkOrdering(broken)
  assert.ok(problems.some(problem => problem.code === 'publish-not-a-transition'), JSON.stringify(problems))
})

test('a channel write before publication is rejected', () => {
  const broken = [
    { id: 'create-draft', writesChannel: false, needsPublished: false },
    { id: 'switch-channel', writesChannel: true, needsPublished: false },
    { id: 'publish', writesChannel: false, needsPublished: false, publishes: true },
  ]
  const problems = checkOrdering(broken)
  assert.ok(problems.some(problem => problem.code === 'channel-before-publish'))
})

test('verifying a published release before publishing is rejected', () => {
  const broken = [
    { id: 'verify-downloadable', writesChannel: false, needsPublished: true },
    { id: 'publish', writesChannel: false, needsPublished: false, publishes: true },
  ]
  const problems = checkOrdering(broken)
  assert.ok(problems.some(problem => problem.code === 'verification-before-publish'))
})

test('two channel writes are rejected', () => {
  const broken = [
    { id: 'publish', writesChannel: false, needsPublished: false, publishes: true },
    { id: 'switch-channel', writesChannel: true, needsPublished: false },
    { id: 'switch-again', writesChannel: true, needsPublished: false },
  ]
  const problems = checkOrdering(broken)
  assert.ok(problems.some(problem => problem.code === 'channel-write-count'))
})

test('a channel write that is not last is rejected', () => {
  const broken = [
    { id: 'publish', writesChannel: false, needsPublished: false, publishes: true },
    { id: 'switch-channel', writesChannel: true, needsPublished: false },
    { id: 'cleanup', writesChannel: false, needsPublished: false },
  ]
  const problems = checkOrdering(broken)
  assert.ok(problems.some(problem => problem.code === 'channel-not-last'))
})

test('a failure at every pre-publication step never touches the channel', () => {
  // Injected one at a time, and asserted as "channelState untouched" rather than as a
  // bare false that would also be true if the step never ran.
  const beforePublish = RELEASE_STEPS.filter(step => step.phase === 'prepare' || step.phase === 'build')
  assert.ok(beforePublish.length > 0)
  for (const step of beforePublish) {
    const result = simulate({ failAt: step.id })
    assert.equal(result.ok, false, step.id)
    assert.equal(result.failedAt, step.id, step.id)
    assert.equal(result.channelState, 'untouched', `${step.id} must not touch the channel`)
    assert.equal(result.published, false, `${step.id} must not publish`)
    // And the steps after it did not run.
    assert.ok(result.skipped.length > 0, `${step.id} must stop the sequence`)
  }
})

test('a failure at publish leaves the channel untouched', () => {
  const result = simulate({ failAt: 'publish' })
  assert.equal(result.ok, false)
  assert.equal(result.published, false)
  assert.equal(result.channelState, 'untouched')
  assert.ok(result.skipped.includes('switch-channel'))
})

test('a failure after publication leaves the release public and the channel untouched', () => {
  // The safe failure: the release is installable, but no client auto-updates to
  // something whose manifest was never verified.
  for (const step of ['verify-downloadable', 'verify-manifest']) {
    const result = simulate({ failAt: step })
    assert.equal(result.ok, false, step)
    assert.equal(result.published, true, `${step}: the release is already public`)
    assert.equal(result.channelState, 'untouched', `${step} must not move the channel`)
    assert.equal(result.channelWritten, false)
  }
})

test('a failure at the channel switch is reported as half-written, not as untouched', () => {
  // These are different incidents: "never advertised" versus "advertisement attempted
  // and may be partially applied". A boolean could not tell them apart.
  const result = simulate({ failAt: 'switch-channel' })
  assert.equal(result.ok, false)
  assert.equal(result.channelState, 'half-written')
  assert.equal(result.channelWritten, true)
})

test('the channel switch is the only step that can half-write the channel', () => {
  for (const step of RELEASE_STEPS) {
    const result = simulate({ failAt: step.id })
    assert.equal(
      result.channelState === 'half-written',
      step.id === 'switch-channel',
      `${step.id}: channelState=${result.channelState}`,
    )
  }
})

test('every model step has a failure injection covered somewhere in this file', () => {
  // A guard on the suite itself: a step with no failure test is a step whose failure
  // mode nobody has thought about.
  for (const step of RELEASE_STEPS) {
    const result = simulate({ failAt: step.id })
    assert.equal(result.failedAt, step.id, `${step.id} cannot be injected`)
  }
})

test('a run at the end of the chain is idempotent in its decision', () => {
  const first = simulate({})
  const second = simulate({})
  assert.deepEqual(first, second)
})

test('the model matches the real release.yml steps', () => {
  // The drift detector. Nothing in the old suite read the workflow, so the model could
  // diverge arbitrarily and stay green.
  //
  // ## What this measures, measured
  //
  // `release.yml` names four relevant steps:
  //
  //   Validate tag, commit, and versions
  //   Verification evidence qualifies this commit
  //   Release qualification
  //   Publish the draft release          <- publish AND the channel switch live here
  //
  // So `switch-channel` is **not** a separate workflow step: it is the final block
  // inside the publish step. The model keeps it separate because the *ordering
  // contract* ("the channel is written last, after verification") is the thing worth
  // asserting, and that is true of a block as well as of a step. This test pins that
  // relationship so a future refactor that splits or moves it is noticed.
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8')
  const stepNames = extractStepNames(workflow)
  assert.ok(stepNames.length > 0, 'no steps were extracted from release.yml')
  const joined = stepNames.join('\n')

  assert.match(joined, /Validate tag, commit, and versions/, 'the metadata step is gone')
  assert.match(joined, /Verification evidence qualifies this commit/, 'the evidence step is gone')
  assert.match(joined, /Release qualification/, 'the qualification step is gone')
  assert.match(joined, /Publish the draft release/, 'the publish step is gone')

  // The channel write must be inside the publish step, and it must come after the
  // publication verification in that same script.
  const publishStep = workflow.slice(workflow.indexOf('- name: Publish the draft release'))
  const publishAt = publishStep.indexOf('--draft=false')
  const verifyAt = publishStep.indexOf('browser_download_url')
  const channelAt = publishStep.indexOf('updater-latest')
  assert.ok(publishAt !== -1, 'the publish step no longer un-drafts the release')
  assert.ok(verifyAt !== -1, 'the publish step no longer verifies the assets are reachable')
  assert.ok(channelAt !== -1, 'the publish step no longer switches the updater channel')
  assert.ok(
    publishAt < verifyAt && verifyAt < channelAt,
    'the publish step must un-draft, then verify reachability, then switch the channel — ' +
      `measured order: draft=false@${publishAt}, assets@${verifyAt}, channel@${channelAt}`,
  )
})

test('the channel write is the last thing the publish step does', () => {
  // A step after the channel switch inside the same script would be able to fail while
  // clients already see the new version. Nothing may follow it.
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8')
  const afterPublish = workflow.slice(workflow.indexOf('- name: Publish the draft release'))
  const channelAt = afterPublish.indexOf('stable channel now points at')
  assert.ok(channelAt > 0, 'the channel-switch confirmation line is gone')
  const tail = afterPublish.slice(channelAt)
  // Only the closing echo lines and the else-branch for non-updater modes may follow.
  assert.doesNotMatch(tail, /gh release (upload|edit|create)\s+"\$?RELEASE_TAG"/, 'nothing may modify the release after the channel switch')
})

test('compareWithWorkflow reports a missing step', () => {
  const problems = compareWithWorkflow(['validate-metadata', 'publish'])
  assert.ok(problems.some(problem => problem.code === 'workflow-missing-step'))
})

test('compareWithWorkflow reports an out-of-order step', () => {
  const problems = compareWithWorkflow(['switch-channel', 'publish'])
  // The model puts publish before the channel switch.
  assert.ok(problems.some(problem => problem.code === 'workflow-order'))
})

test('compareWithWorkflow accepts a correctly ordered subset', () => {
  const ordered = RELEASE_STEPS.map(step => step.id)
  assert.deepEqual(compareWithWorkflow(ordered), [])
})

/** Pull `- name:` values out of a workflow file, in order. */
function extractStepNames(yaml) {
  const names = []
  for (const line of yaml.split('\n')) {
    const match = /^\s+- name:\s*(.+?)\s*$/.exec(line)
    if (match) names.push(match[1].replace(/^['"]|['"]$/g, ''))
  }
  return names
}
