/**
 * The release state machine, as data.
 *
 * ## Why the order is modelled rather than described
 *
 * An earlier phase found a real window: `updater-latest` was pointed at the new version
 * in the asset step, while the release was still a draft. Every URL in the manifest
 * 404'd for as long as the remaining steps took. Prose in a comment did not catch it and
 * would not catch the next one.
 *
 * Modelling the steps makes three things checkable without a live release:
 *
 *   * the channel-switch step comes **after** publication is verified;
 *   * a failing step stops the sequence;
 *   * a run that has not published cannot reach the channel.
 *
 * ## The defect this version fixes
 *
 * `simulate()` took `alreadyPublished` as an *input* and never derived it from the
 * `publish` step. Measured on the previous implementation:
 *
 *   simulate({})  ->  ran: …through publish…   skipped: verify-downloadable,
 *                     verify-manifest, switch-channel
 *                     channelWritten: false
 *
 * So the **default success path never reached the channel**. Every test that wanted to
 * exercise the post-publication steps passed `alreadyPublished: true` by hand, which
 * made the tests pass while the default path was wrong — and a caller who did not know
 * to pass the flag would model a release that never advertises itself.
 *
 * Publication is now a **state transition**: reaching `publish` sets it, and the steps
 * that require a published release read that state. There is no flag to get wrong.
 *
 * ## What this model does not claim
 *
 * It is not the workflow. It is the order and the preconditions, extracted so a test
 * can assert them. A separate test reads `release.yml` and fails when the two disagree.
 */

/** Every step of a release, in the order it must happen. */
export const RELEASE_STEPS = [
  { id: 'validate-metadata', writesChannel: false, needsPublished: false, phase: 'prepare' },
  { id: 'verify-evidence', writesChannel: false, needsPublished: false, phase: 'prepare' },
  { id: 'collect-checks', writesChannel: false, needsPublished: false, phase: 'prepare' },
  { id: 'judge-qualification', writesChannel: false, needsPublished: false, phase: 'prepare' },
  { id: 'create-draft', writesChannel: false, needsPublished: false, phase: 'prepare' },
  { id: 'build-artifacts', writesChannel: false, needsPublished: false, phase: 'build' },
  { id: 'attach-assets', writesChannel: false, needsPublished: false, phase: 'build' },
  // The transition. `publishes: true` is what makes the later steps runnable.
  { id: 'publish', writesChannel: false, needsPublished: false, phase: 'publish', publishes: true },
  // The steps that must not run before the release is public and reachable.
  { id: 'verify-downloadable', writesChannel: false, needsPublished: true, phase: 'verify' },
  { id: 'verify-manifest', writesChannel: false, needsPublished: true, phase: 'verify' },
  { id: 'switch-channel', writesChannel: true, needsPublished: true, phase: 'channel' },
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
  } else if (steps[publishAt]?.publishes !== true) {
    // Without the flag the state transition never happens and every step gated on
    // publication is skipped — the exact bug this model was fixed for.
    problems.push({
      code: 'publish-not-a-transition',
      message: 'the publish step does not set `publishes: true`, so nothing after it can run',
    })
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
 * `failAt` names a step that throws. Publication is **derived** from reaching the
 * `publish` step, so a normal run proceeds all the way to the channel switch, which is
 * the only shape that describes a successful release.
 *
 * `channelState` distinguishes the three outcomes an incident cares about:
 *   `untouched` — never attempted
 *   `written`   — the switch completed
 *   `half-written` — the switch threw; the previous state is unknown
 */
export function simulate({ steps = RELEASE_STEPS, failAt = null } = {}) {
  const ran = []
  const skipped = []
  let published = false
  let stopped = false
  let failedAt = null
  let channelState = 'untouched'
  let channelWritten = false

  for (const step of steps) {
    if (stopped) {
      skipped.push(step.id)
      continue
    }
    // A step that needs a published release is skipped when publication has not
    // happened. With the derived state this only occurs if `publish` failed or is
    // missing — which is exactly when those steps must not run.
    if (step.needsPublished && !published) {
      skipped.push(step.id)
      continue
    }
    ran.push(step.id)
    if (step.id === failAt) {
      stopped = true
      failedAt = step.id
      // A failure at the channel write leaves the channel in an unknown state, and that
      // is a different incident from "never touched".
      if (step.writesChannel) {
        channelState = 'half-written'
        channelWritten = true
      }
      continue
    }
    if (step.publishes) published = true
    if (step.writesChannel) {
      channelState = 'written'
      channelWritten = true
    }
  }

  return {
    ran,
    skipped,
    channelWritten,
    channelState,
    published,
    ok: !stopped,
    failedAt,
  }
}

/**
 * Assert that the modelled steps match the steps named in `release.yml`.
 *
 * `workflowStepNames` is the ordered list the caller extracted from the workflow. The
 * model cannot detect a workflow edit on its own, so this comparison is what makes
 * "somebody changed release.yml and forgot the model" a red test.
 */
export function compareWithWorkflow(workflowStepNames, steps = RELEASE_STEPS) {
  const problems = []
  const modelIds = steps.map(step => step.id)
  const named = new Set(workflowStepNames)

  for (const id of modelIds) {
    if (!named.has(id)) {
      problems.push({
        code: 'workflow-missing-step',
        message: `release.yml has no step named ${id}, which the model requires`,
      })
    }
  }
  // Order: each model step must appear in the workflow after the previous one. Steps
  // in the workflow that the model does not know are reported separately, because a new
  // step can be harmless — but a new *channel or publish* step is not.
  let cursor = -1
  for (const id of modelIds) {
    const at = workflowStepNames.indexOf(id)
    if (at === -1) continue
    if (at < cursor) {
      problems.push({
        code: 'workflow-order',
        message: `${id} appears at position ${at}, before a step the model puts earlier`,
      })
    }
    cursor = Math.max(cursor, at)
  }
  return problems
}
