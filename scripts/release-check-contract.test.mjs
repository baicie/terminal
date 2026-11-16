// T12 — the release contract, validated against the real workflow files.
//
// The measured drift: `verify-release-qualification.mjs` said its required list was
// "the same as CI / required plus the GUI gate", and the GUI gate was not in it. Both
// lists looked authoritative; neither test compared them.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  INFORMATIONAL_RELEASE_JOBS,
  PR_EVIDENCE_CHECKS,
  RELEASE_CHECKS,
  RELEASE_CHECK_OWNERS,
  REQUIRED_RELEASE_CHECKS,
  validateContract,
} from './release-check-contract.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

/** Read a workflow's job display names, job keys and continue-on-error names. */
export function readWorkflow(relativePath) {
  const yaml = readFileSync(path.join(ROOT, relativePath), 'utf8')
  const jobsBlock = yaml.split(/^jobs:\s*$/m)[1] ?? ''
  const jobNames = []
  const jobKeys = []
  const continueOnError = []

  const lines = jobsBlock.split('\n')
  let currentKey = null
  let currentName = null
  let indentOfJobs = null
  for (const line of lines) {
    const keyMatch = /^(\s{2})([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (keyMatch && indentOfJobs === null) indentOfJobs = 2
    if (keyMatch) {
      // A new job starts. Record the previous one.
      if (currentKey) {
        jobKeys.push(currentKey)
        if (currentName) jobNames.push(currentName)
      }
      currentKey = keyMatch[2]
      currentName = null
      continue
    }
    if (currentKey === null) continue
    const nameMatch = /^\s{4}name:\s*(.+?)\s*$/.exec(line)
    if (nameMatch) {
      currentName = nameMatch[1].replace(/^['"]|['"]$/g, '')
      // A job with no explicit `name:` reports its key as the check name.
    }
    if (/^\s{4}continue-on-error:\s*true\s*$/.test(line)) {
      continueOnError.push(currentName ?? currentKey)
    }
  }
  if (currentKey) {
    jobKeys.push(currentKey)
    if (currentName) jobNames.push(currentName)
  }
  return { jobKeys, jobNames, continueOnError }
}

test('every required release check exists as a job in its claimed workflow', () => {
  // This is the drift detector. It failed before the fix, because the GUI gate was
  // claimed in a comment and absent from the list.
  const workflows = {
    '.github/workflows/ci.yml': readWorkflow('.github/workflows/ci.yml'),
    '.github/workflows/native-gui-e2e.yml': readWorkflow('.github/workflows/native-gui-e2e.yml'),
  }
  const problems = validateContract(workflows)
  assert.deepEqual(problems, [], JSON.stringify(problems, null, 2))
})

test('the naive GUI addition would have been wrong, and is modelled instead', () => {
  // `native-gui-e2e.yml` has no push/tag trigger, so a tag push produces no GUI run.
  // Requiring it "on-commit" would make every release fail with check-missing.
  const gui = readFileSync(path.join(ROOT, '.github/workflows/native-gui-e2e.yml'), 'utf8')
  const triggers = gui.split(/^on:\s*$/m)[1]?.split(/^permissions:/m)[0] ?? ''
  assert.doesNotMatch(triggers, /^\s{2}push:/m, 'the GUI workflow must have no push trigger')

  for (const name of PR_EVIDENCE_CHECKS) {
    const check = RELEASE_CHECKS.find(entry => entry.name === name)
    assert.equal(check.freshness, 'pr-evidence', `${name} must be verified from PR-time evidence`)
    assert.ok(check.note, `${name} needs a note explaining why it is PR-time`)
  }
})

test('the GUI gate IS in the release contract now', () => {
  // The comment claimed it; now the list proves it.
  const guiChecks = REQUIRED_RELEASE_CHECKS.filter(name =>
    RELEASE_CHECK_OWNERS[name] === '.github/workflows/native-gui-e2e.yml',
  )
  assert.ok(guiChecks.length > 0, 'the GUI gate must be part of the release contract')
  assert.ok(guiChecks.includes('macOS GUI E2E'), 'the blocking GUI platform must be required')
})

test('informational GUI platforms are NOT required for a release', () => {
  // Requiring a continue-on-error job proves nothing, so the gate must exclude them.
  for (const job of INFORMATIONAL_RELEASE_JOBS) {
    assert.ok(
      !REQUIRED_RELEASE_CHECKS.includes(job),
      `${job} is informational and must not be a required release check`,
    )
  }
  assert.ok(REQUIRED_RELEASE_CHECKS.includes('Driver isolation gate'), 'the blocking GUI gate is required')
})

test('the informational release set matches the workflows', () => {
  // Drift detector for the other direction: a job that becomes blocking must be
  // removed from this set, or the contract will silently keep excluding a real gate.
  const workflows = {
    '.github/workflows/ci.yml': readWorkflow('.github/workflows/ci.yml'),
    '.github/workflows/native-gui-e2e.yml': readWorkflow('.github/workflows/native-gui-e2e.yml'),
  }
  for (const [file, workflow] of Object.entries(workflows)) {
    for (const name of workflow.continueOnError) {
      assert.ok(
        INFORMATIONAL_RELEASE_JOBS.has(name),
        `${file}: ${name} is continue-on-error but is not registered as informational`,
      )
    }
  }
})

test('every required check has an owner mapping', () => {
  for (const name of REQUIRED_RELEASE_CHECKS) {
    assert.ok(RELEASE_CHECK_OWNERS[name] !== undefined, `${name} has no owner mapping`)
  }
})

test('no owner mapping is orphaned', () => {
  for (const name of Object.keys(RELEASE_CHECK_OWNERS)) {
    assert.ok(REQUIRED_RELEASE_CHECKS.includes(name), `${name} is mapped but not required`)
  }
})

test('a continue-on-error job in the required set is rejected by validateContract', () => {
  // Proves the check works, using a synthetic workflow.
  const problems = validateContract({
    '.github/workflows/ci.yml': {
      jobNames: ['Rust quality'],
      continueOnError: ['Rust quality'],
      jobKeys: ['rust'],
    },
    '.github/workflows/native-gui-e2e.yml': {
      jobNames: ['Driver isolation gate', 'macOS GUI E2E', 'Frontend quality', 'Team Server quality',
        'Repository gates (source size, evidence, script tests)', 'Tauri build (macos-latest)',
        'Tauri build (ubuntu-latest)', 'Tauri build (windows-latest)', 'cargo audit (blocking)',
        'Dependency audit (npm)', 'Team Server container', 'required'],
      continueOnError: [],
      jobKeys: [],
    },
  })
  assert.ok(problems.some(problem => problem.code === 'contract-informational-required'))
})

test('a check with no matching job is rejected', () => {
  const problems = validateContract({
    '.github/workflows/ci.yml': { jobNames: [], continueOnError: [], jobKeys: [] },
    '.github/workflows/native-gui-e2e.yml': { jobNames: [], continueOnError: [], jobKeys: [] },
  })
  assert.ok(problems.some(problem => problem.code === 'contract-missing-job'))
})

test('every release mode offered in the dispatch input can actually succeed', () => {
  // The trap: `fully-signed` was selectable and always failed, so an operator chose it
  // and only learned after the build started. A mode that cannot succeed must not be
  // offered.
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8')
  const optionsBlock = /release_mode:[\s\S]*?options:\n((?:\s{10}- .+\n)+)/.exec(workflow)
  assert.ok(optionsBlock, 'the release_mode input no longer lists options')
  const offered = optionsBlock[1]
    .split('\n')
    .map(line => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)

  assert.deepEqual(offered.sort(), ['unsigned-qa', 'updater-signed'].sort())

  // And the runtime guard still exists for the modes that are not offered: an API
  // dispatch is not constrained by `options:`, so the early refusal must remain.
  assert.match(workflow, /fully-signed\)/, 'the fully-signed guard must stay as defence in depth')
})

test('a malformed RELEASE_CHECK_APP_IDS stops the release instead of trusting every App', async () => {
  // The previous parser filtered non-numerics and returned null when nothing remained,
  // and null means "any App may satisfy a required check". A typo therefore *widened*
  // the trust boundary — the opposite of failing closed.
  const { execFileSync } = await import('node:child_process')
  const script = path.join(ROOT, 'scripts/release-facts.mjs')

  // `release-facts.mjs` runs `main()` on import only when invoked directly; importing it
  // would talk to `gh`. Instead assert the parser contract through the module source:
  // the function must not return null, and must reject a non-numeric value.
  const source = readFileSync(script, 'utf8')
  assert.match(source, /is not a comma-separated list of positive/, 'the parser must reject a bad value')
  assert.doesNotMatch(
    source,
    /return ids\.length > 0 \? new Set\(ids\) : null/,
    'returning null means "trust every App" and must not come back',
  )
  // And the empty case is explicit rather than accidental.
  assert.match(source, /return new Set\(\)/, 'an empty value must allow no App, explicitly')
  void execFileSync
})

test('the App allowlist is documented as insufficient on its own', () => {
  // App id is the same for every workflow in the repository, so it cannot be the whole
  // provenance story; the workflow path comparison is what makes it meaningful.
  // Whitespace-normalised so a re-wrapped comment still matches.
  const source = readFileSync(path.join(ROOT, 'scripts/release-facts.mjs'), 'utf8').replace(/\s+/g, ' ')
  assert.match(source, /App id is identical for every workflow/, 'the limitation must stay documented')
  assert.match(source, /carries the workflow/, 'the resolution via details_url must stay documented')
})
