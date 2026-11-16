/**
 * Which jobs are informational, decided by identity rather than by substring.
 *
 * ## Why `name.includes('informational')` is not a permission slip
 *
 * The previous rule treated any job whose *name* contains the word "informational" as
 * non-blocking. Three things are wrong with that:
 *
 *  1. **A rename silently changes the gate.** Removing the word from `native-gui-e2e.yml`
 *     would make a long-failing job blocking with no code change, and adding it to any
 *     job in any workflow would silently make a real gate advisory. The rule lived in
 *     a string, not in a decision anyone had to make.
 *  2. **It is a spoofable input.** A job name is data from the API. Anyone who can add
 *     a workflow file can name a job `Rust quality (informational)`.
 *  3. **It is cross-workflow blind.** `ci.yml`'s attribution job only ever sees
 *     `ci.yml`'s own run. The GUI jobs live in `native-gui-e2e.yml`, a *different*
 *     workflow with a *different* run id, so they never appear in that job list at all.
 *     The previous code could not have classified them even in principle.
 *
 * ## The rule now
 *
 * An explicit allowlist keyed by `workflow file` + `job name`. Anything not on it is
 * **blocking**, including a job nobody has classified — the safe default, and the one
 * that makes adding a job a deliberate act.
 *
 * ## Cross-workflow collection
 *
 * `collectRelatedRuns` describes how to find the sibling runs for a commit. When a
 * sibling workflow was never triggered, that is reported as `NOT_COLLECTED` with the
 * reason, never as "no failure".
 */

/**
 * Informational jobs, by workflow file and job name.
 *
 * `why` is required: an entry without a recorded reason is how "temporary" becomes
 * permanent. `removeWhen` states the condition for deleting the entry, so the next
 * reader knows what evidence would let them tighten the gate.
 */
export const INFORMATIONAL_JOBS = [
  {
    workflow: '.github/workflows/native-gui-e2e.yml',
    job: 'Windows GUI E2E (informational)',
    why: 'the app builds and starts on Windows but no GUI case has a stable pass record',
    removeWhen: 'the Windows GUI suite passes on N consecutive runs — then drop the suffix and continue-on-error',
  },
  {
    workflow: '.github/workflows/native-gui-e2e.yml',
    job: 'Linux GUI E2E (informational)',
    why: 'same: builds and starts under Xvfb but no stable pass record',
    removeWhen: 'the Linux GUI suite passes on N consecutive runs',
  },
  {
    workflow: '.github/workflows/ci.yml',
    job: 'zsh probe diagnostic',
    // AGENTS.md records that this job's success does not constitute a product gate.
    // It is `continue-on-error: true` in the workflow *and* absent from `required`'s
    // needs, so this entry only affects how the attribution report words it.
    why: 'diagnostic; continue-on-error by design and not in the required aggregation (AGENTS.md)',
    removeWhen: 'never — it is a diagnostic by intent, but revisit if it starts catching bugs',
  },
]

/**
 * Is this job informational?
 *
 * Returns `{ informational, known, why }`. A job that is not on the allowlist has
 * `informational: false` and `known: false`, which the report renders as
 * "unclassified" so a newly-added job is visible rather than assumed safe.
 */
export function informationalFor(workflowFile, jobName, allowlist = INFORMATIONAL_JOBS) {
  const normalisedWorkflow = String(workflowFile ?? '').replace(/^\.\//, '')
  const entry = allowlist.find(
    candidate => candidate.workflow === normalisedWorkflow && candidate.job === jobName,
  )
  if (entry) {
    return { informational: true, known: true, why: entry.why, removeWhen: entry.removeWhen }
  }
  return { informational: false, known: false, why: null, removeWhen: null }
}

/**
 * Every job that must be on the allowlist for a workflow, and whether it is.
 *
 * Used by a test that reads `native-gui-e2e.yml` and asserts its `continue-on-error`
 * jobs are exactly the allowlisted ones. That is the drift detector: adding
 * `continue-on-error: true` without adding an allowlist entry fails the test, and
 * removing the flag without removing the entry fails it too.
 */
export function auditAllowlist(workflowFile, jobNames, allowlist = INFORMATIONAL_JOBS) {
  const declared = jobNames
    .map(name => ({ name, ...informationalFor(workflowFile, name, allowlist) }))
    .map(entry => ({ job: entry.name, informational: entry.informational, known: entry.known }))
  const stale = allowlist.filter(
    entry => normalised(entry.workflow) === normalised(workflowFile) && !jobNames.includes(entry.job),
  )
  return { declared, stale }
}

function normalised(file) {
  return String(file ?? '').replace(/^\.\//, '')
}

/**
 * How to find the other workflow runs for the same commit.
 *
 * Each entry names a workflow file and the conditions under which its runs are
 * relevant. `collectRelatedRuns` in the CLI uses this to decide what to fetch; the
 * decision is data so a new workflow is one edit, not a new branch.
 */
export const RELATED_WORKFLOWS = [
  {
    workflow: '.github/workflows/native-gui-e2e.yml',
    displayName: 'Native GUI E2E',
    // The workflow is path-filtered. When it is filtered out there is no run to read,
    // and that is `NOT_COLLECTED`, not "GUI passed".
    reportWhenMissing: 'the GUI workflow did not run for this commit (path filter or no PR event)',
  },
]

/**
 * Summarise what was and was not collected.
 *
 * `NOT_COLLECTED` exists so that a missing sibling run cannot be read as a pass. The
 * report prints it verbatim.
 */
export function summariseCollection({ selfRun, siblings = [] }) {
  return {
    self: selfRun
      ? { runId: selfRun.runId, status: 'COLLECTED' }
      : { runId: null, status: 'NOT_COLLECTED', reason: 'the CI run itself could not be read' },
    siblings: siblings.map(entry =>
      entry.run
        ? { workflow: entry.workflow, runId: entry.run.id, status: 'COLLECTED' }
        : {
            workflow: entry.workflow,
            runId: null,
            status: 'NOT_COLLECTED',
            reason: entry.reason ?? 'no run found for this commit',
          },
    ),
  }
}
