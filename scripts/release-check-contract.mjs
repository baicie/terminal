/**
 * The release gate's contract, derived from the workflows rather than typed twice.
 *
 * ## The drift this removes
 *
 * `REQUIRED_RELEASE_CHECKS` was a hand-maintained list of **job display names**, and
 * its own comment claimed it mirrored `CI / required` "plus the GUI gate". Measured:
 *
 *   REQUIRED_RELEASE_CHECKS.includes(anything matching /gui/i)  ->  false
 *
 * So a release could ship with a red GUI gate, and the comment said otherwise. Two
 * lists that must agree, typed by hand, will eventually disagree — and the disagreement
 * is invisible because both look authoritative.
 *
 * ## The structure
 *
 * | Set | Source of truth | Why |
 * | --- | --- | --- |
 * | `required` | `ci.yml` | the merge gate |
 * | per-job names | `ci.yml` | the release must not skip a check a merge requires |
 * | GUI gate | `native-gui-e2e.yml` | a separate workflow, hence a separate run |
 *
 * A check belongs to a **workflow file**, and that is the unit the provenance check
 * verifies. Names alone are not unique across workflows.
 */

/**
 * Which workflow owns which required check.
 *
 * Keyed by the check's display name because that is what the Checks API returns; the
 * value is the workflow path that is allowed to publish it. This mapping is what makes
 * the spoofing test meaningful — without it, "same name" is indistinguishable from
 * "same source".
 */
export const RELEASE_CHECK_OWNERS = {
  required: '.github/workflows/ci.yml',
  'Frontend quality': '.github/workflows/ci.yml',
  'Rust quality': '.github/workflows/ci.yml',
  'Team Server quality': '.github/workflows/ci.yml',
  'Repository gates (source size, evidence, script tests)': '.github/workflows/ci.yml',
  'Tauri build (macos-latest)': '.github/workflows/ci.yml',
  'Tauri build (ubuntu-latest)': '.github/workflows/ci.yml',
  'Tauri build (windows-latest)': '.github/workflows/ci.yml',
  'cargo audit (blocking)': '.github/workflows/ci.yml',
  'Dependency audit (npm)': '.github/workflows/ci.yml',
  'Team Server container': '.github/workflows/ci.yml',
  // ## The GUI gate, and why it is here with a documented caveat
  //
  // The comment in `verify-release-qualification.mjs` said this was included; it was
  // not. Adding the name naively would make **every** release fail, because
  // `native-gui-e2e.yml` has no `push`/tag trigger — a tag push produces no GUI run at
  // all, so the check would always be `check-missing`.
  //
  // The resolution is `guiGate: 'required-on-pr'`: the gate is enforced where it can
  // be enforced (every PR must have it), and a release verifies it **against the
  // commit's PR-time run** rather than expecting a fresh one on the tag. The caller
  // must supply that run's facts; when it cannot, the verdict is `NOT_COLLECTED` and
  // the release is refused. That is honest, and it is not a silent skip.
  'Driver isolation gate': '.github/workflows/native-gui-e2e.yml',
  'macOS GUI E2E': '.github/workflows/native-gui-e2e.yml',
}

/** Checks that must exist on the release commit's evidence, and how they are obtained. */
export const RELEASE_CHECKS = [
  { name: 'required', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  { name: 'Frontend quality', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  { name: 'Rust quality', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  { name: 'Team Server quality', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  {
    name: 'Repository gates (source size, evidence, script tests)',
    owner: '.github/workflows/ci.yml',
    freshness: 'on-commit',
  },
  { name: 'Tauri build (macos-latest)', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  { name: 'Tauri build (ubuntu-latest)', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  { name: 'Tauri build (windows-latest)', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  { name: 'cargo audit (blocking)', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  { name: 'Dependency audit (npm)', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  { name: 'Team Server container', owner: '.github/workflows/ci.yml', freshness: 'on-commit' },
  {
    name: 'Driver isolation gate',
    owner: '.github/workflows/native-gui-e2e.yml',
    freshness: 'pr-evidence',
    note: 'the GUI workflow has no tag trigger; verified against the commit PR-time run',
  },
  {
    name: 'macOS GUI E2E',
    owner: '.github/workflows/native-gui-e2e.yml',
    freshness: 'pr-evidence',
    note: 'same: PR-time run, not a tag-time run',
  },
]

/** `continue-on-error` jobs that are informational and must not gate a release. */
export const INFORMATIONAL_RELEASE_JOBS = new Set([
  'Windows GUI E2E (informational)',
  'Linux GUI E2E (informational)',
  'zsh probe diagnostic',
  'Test execution report',
])

/**
 * Validate the contract against the workflow files.
 *
 * `workflows` maps a workflow path to `{jobKeys, jobNames, continueOnError}`. Every
 * check in `RELEASE_CHECKS` must name a job that exists, in the workflow that is said
 * to own it. A check whose owner does not define it is a contract bug: the release gate
 * would look for a check that can never appear.
 */
export function validateContract(workflows) {
  const problems = []

  for (const check of RELEASE_CHECKS) {
    const workflow = workflows[check.owner]
    if (workflow === undefined) {
      problems.push({
        code: 'contract-missing-workflow',
        message: `${check.name} claims owner ${check.owner}, which was not provided`,
      })
      continue
    }
    // A matrix job's display name is a template (`Tauri build (${{ matrix.os }})`) and
    // GitHub expands it into one check per combination. Comparing the literal string
    // would report three false problems and train a reader to ignore the gate. The
    // match is therefore: exact, or the template whose expansion produced this name.
    if (!workflow.jobNames.includes(check.name) && !matchesMatrixTemplate(check.name, workflow.jobNames)) {
      problems.push({
        code: 'contract-missing-job',
        message:
          `${check.name} is listed as a required release check but ${check.owner} ` +
          `defines no job with that name (it has: ${workflow.jobNames.join(', ')})`,
      })
    }
    if (workflow.continueOnError?.includes(check.name)) {
      // A `continue-on-error` job reports `success` even when it failed, so requiring
      // it proves nothing. This is the trap that makes a gate look present.
      problems.push({
        code: 'contract-informational-required',
        message:
          `${check.name} is continue-on-error, so requiring it in the release gate ` +
          'verifies nothing: the job reports success regardless of what it did',
      })
    }
  }

  // The reverse direction: a check-owner mapping for a job that no longer exists is
  // stale and should be removed, or it will silently stop protecting anything.
  for (const [name, owner] of Object.entries(RELEASE_CHECK_OWNERS)) {
    const workflow = workflows[owner]
    if (workflow === undefined) continue
    const listed = RELEASE_CHECKS.some(check => check.name === name)
    if (!listed) {
      problems.push({
        code: 'contract-orphan-owner',
        message: `${name} has an owner mapping but is not in RELEASE_CHECKS`,
      })
    }
  }

  return problems
}

/** Just the names, for the release gate's loop. */
export const REQUIRED_RELEASE_CHECKS = RELEASE_CHECKS.map(check => check.name)

/** Names whose run must be found at PR time rather than at tag time. */
export const PR_EVIDENCE_CHECKS = RELEASE_CHECKS.filter(check => check.freshness === 'pr-evidence').map(
  check => check.name,
)

/**
 * Does a concrete check name come from a matrix job template?
 *
 * `Tauri build (macos-latest)` is produced by the job named
 * `Tauri build (${{ matrix.os }})` with `os: [macos-latest, ubuntu-latest, windows-latest]`.
 * The template is turned into a prefix/suffix pair around the single expression, and a
 * name matches when it starts and ends with those parts and the middle is non-empty.
 *
 * Only a *single* `${{ }}` expression is supported, because that is what this repository
 * uses. A template with two expressions would make the mapping ambiguous, and guessing
 * is worse than reporting the job as unmatched.
 */
export function matchesMatrixTemplate(name, templates) {
  for (const template of templates) {
    const match = /^(.*?)\$\{\{\s*[^}]+\s*\}\}(.*)$/.exec(template)
    if (!match) continue
    const [, prefix, suffix] = match
    if (name.length > prefix.length + suffix.length && name.startsWith(prefix) && name.endsWith(suffix)) {
      return true
    }
  }
  return false
}
