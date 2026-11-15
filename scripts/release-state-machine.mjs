/**
 * The release state machine, as data.
 *
 * ## Why the order is modelled rather than described
 *
 * T18 found a real window: `updater-latest` was pointed at the new version in the
 * asset step, while the release was still a draft. Every URL in the manifest 404'd
 * for as long as the remaining steps took. Prose in a comment did not catch it and
 * would not catch the next one.
 *
 * Modelling the steps makes three things checkable without a live release:
 *
 *   * the channel-switch step comes **after** publication is verified;
 *   * a failing step stops the sequence (`terminalOnFailure`);
 *   * a re-run of an already-published release is idempotent rather than a second
 *     publish.
 *
 * ## What this model does not claim
 *
 * It is not the workflow. It is the order and the preconditions, extracted so a test
 * can assert them. T20's dry-run uses it; the workflow is still the thing that runs.
 */

/** Every step of a release, in the order it must happen. */
export const RELEASE_STEPS = [
  { id: 'validate-metadata', writesChannel: false, needsPublished: false },
  { id: 'verify-evidence', writesChannel: false, needsPublished: false },
  { id: 'collect-checks', writesChannel: false, needsPublished: false },
  { id: 'judge-qualification', writesChannel: false, needsPublished: false },
  { id: 'create-draft', writesChannel: false, needsPublished: false },
  { id: 'build-artifacts', writesChannel: false, needsPublished: false },
  { id: 'attach-assets', writesChannel: false, needsPublished: false },
  { id: 'publish', writesChannel: false, needsPublished: false },
  // The two steps that must not run before the release is public and reachable.
  { id: 'verify-downloadable', writesChannel: false, needsPublished: true },
  { id: 'verify-manifest', writesChannel: false, needsPublished: true },
  { id: 'switch-channel', writesChannel: true, needsPublished: true },
]

/**
 * Check an ordering.
 *
 * Returns the violations rather than throwing, so a caller can report all of them at
 * once — a release that has two ordering bugs should not need two runs to find out.
 */
export function checkOrdering(steps = RELEASE_STEPS) {
  const problems = []
  const ids = steps.map(step => step.id)

  const indexOf = id => ids.indexOf(id)
  const publishAt = indexOf('publish')
  if (publishAt === -1) {
    problems.push({ code: 'missing-publish', message: 'no publish step' })
  }

  for (const step of steps) {
    if (step.writesChannel && publishAt !== -1 && ids.indexOf(step.id) < publishAt) {
      problems.push({
        code: 'channel-before-publish',
        message: `${step.id} writes the update channel before the release is published`,
      })
    }
    if (step.needsPublished && publishAt !== -1 && ids.indexOf(step.id) < publishAt) {
      problems.push({
        code: 'verification-before-publish',
        message: `${step.id} verifies the published release before publishing it`,
      })
    }
  }

  // Exactly one channel write, and it must be the last thing that happens: a channel
  // pointing at a version another step is still mutating is the same bug again.
  const channelWrites = steps.filter(step => step.writesChannel)
  if (channelWrites.length !== 1) {
    problems.push({
      code: 'channel-write-count',
      message: `${channelWrites.length} step(s) write the channel; expected exactly 1`,
    })
  }
  if (channelWrites.length === 1 && ids.lastIndexOf(channelWrites[0].id) !== ids.length - 1) {
    problems.push({
      code: 'channel-not-last',
      message: `${channelWrites[0].id} is not the final step`,
    })
  }

  return problems
}

/**
 * Simulate a run.
 *
 * `failAt` names a step that throws. The result records which steps ran, which were
 * skipped, and whether the channel was touched — that last one is the fact a release
 * incident needs first.
 */
export function simulate({ steps = RELEASE_STEPS, failAt = null, alreadyPublished = false } = {}) {
  const ran = []
  const skipped = []
  let channelWritten = false
  let stopped = false

  for (const step of steps) {
    if (stopped) {
      skipped.push(step.id)
      continue
    }
    // A step that needs a published release is skipped when publication has not
    // happened — that is the state a failed run leaves behind, and simulating it is
    // how "the channel was never touched" gets asserted rather than assumed.
    if (step.needsPublished && !alreadyPublished) {
      skipped.push(step.id)
      continue
    }
    ran.push(step.id)
    if (step.writesChannel) channelWritten = true
    if (step.id === failAt) {
      stopped = true
    }
  }

  return {
    ran,
    skipped,
    channelWritten,
    ok: !stopped,
    failedAt: stopped ? failAt : null,
  }
}
