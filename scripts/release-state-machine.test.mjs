// T20 — the release order, and what a dry-run of it proves.
//
// These are the assertions a real release cannot afford to discover by running one.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RELEASE_STEPS,
  checkOrdering,
  simulate,
} from './release-state-machine.mjs'

test('the workspace order is valid', () => {
  assert.deepEqual(checkOrdering(), [])
})

test('the channel switch is the last step', () => {
  const ids = RELEASE_STEPS.map(step => step.id)
  assert.equal(ids[ids.length - 1], 'switch-channel')
})

test('a channel write before publication is rejected', () => {
  // T18's actual defect: `updater-latest` was updated in the asset step, while the
  // release was still a draft, so every URL in the manifest 404'd until publication.
  const broken = [
    { id: 'create-draft', writesChannel: false, needsPublished: false },
    { id: 'switch-channel', writesChannel: true, needsPublished: false },
    { id: 'publish', writesChannel: false, needsPublished: false },
  ]
  const problems = checkOrdering(broken)
  assert.ok(
    problems.some(p => p.code === 'channel-before-publish'),
    JSON.stringify(problems),
  )
})

test('verifying a published release before publishing is rejected', () => {
  const broken = [
    { id: 'verify-downloadable', writesChannel: false, needsPublished: true },
    { id: 'publish', writesChannel: false, needsPublished: false },
  ]
  const problems = checkOrdering(broken)
  assert.ok(problems.some(p => p.code === 'verification-before-publish'))
})

test('two channel writes are rejected', () => {
  const broken = [
    { id: 'publish', writesChannel: false, needsPublished: false },
    { id: 'switch-channel', writesChannel: true, needsPublished: false },
    { id: 'switch-again', writesChannel: true, needsPublished: false },
  ]
  const problems = checkOrdering(broken)
  assert.ok(problems.some(p => p.code === 'channel-write-count'))
})

test('a channel write that is not last is rejected', () => {
  const broken = [
    { id: 'publish', writesChannel: false, needsPublished: false },
    { id: 'switch-channel', writesChannel: true, needsPublished: false },
    { id: 'cleanup', writesChannel: false, needsPublished: false },
  ]
  const problems = checkOrdering(broken)
  assert.ok(problems.some(p => p.code === 'channel-not-last'))
})

test('a failure before publication never touches the channel', () => {
  // The question an incident asks first: did this run advertise a version that does
  // not exist? For a pre-publication failure the answer must be no.
  for (const step of ['validate-metadata', 'verify-evidence', 'collect-checks', 'judge-qualification', 'create-draft', 'build-artifacts', 'attach-assets']) {
    const result = simulate({ failAt: step })
    assert.equal(result.ok, false, step)
    assert.equal(result.channelWritten, false, `${step} must not write the channel`)
    assert.equal(result.failedAt, step)
  }
})

test('a failure after publication leaves the channel untouched but the release public', () => {
  // This is the state T18's post-publish verification can leave: release is visible,
  // channel still points at the previous version. That is the safe failure — users
  // cannot auto-update to something unverified, and the version is still installable.
  const result = simulate({ failAt: 'verify-manifest', alreadyPublished: true })
  assert.equal(result.ok, false)
  assert.equal(result.channelWritten, false)
  assert.ok(result.ran.includes('publish'))
})

test('a failure at the channel switch is the only case where the channel may be half-written', () => {
  const result = simulate({ failAt: 'switch-channel', alreadyPublished: true })
  assert.equal(result.ok, false)
  assert.equal(result.channelWritten, true, 'the switch was attempted')
  // And it is the last step, so nothing after it depends on a half-written channel.
  assert.equal(result.skipped.length, 0)
})

test('a clean run writes the channel exactly once, last', () => {
  const result = simulate({ alreadyPublished: true })
  assert.equal(result.ok, true)
  assert.equal(result.channelWritten, true)
  assert.equal(result.ran[result.ran.length - 1], 'switch-channel')
  assert.deepEqual(result.skipped, [])
})

test('a run that never published does not reach the channel', () => {
  // Missing `alreadyPublished` is what a failed run looks like. The channel steps are
  // skipped rather than attempted against a draft.
  const result = simulate({ alreadyPublished: false })
  assert.equal(result.channelWritten, false)
  assert.ok(result.skipped.includes('switch-channel'))
})

test('a repeated run is idempotent: the same steps, the same verdict', () => {
  // Idempotence of the *decision*, which is what a re-run of a failed release needs.
  // The workflow's own `--clobber` uploads and `gh release edit` are what make the
  // side effects idempotent; this pins that nothing in the order depends on a
  // previous attempt.
  const first = simulate({ alreadyPublished: true })
  const second = simulate({ alreadyPublished: true })
  assert.deepEqual(first, second)
})
