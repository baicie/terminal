// T05 — informational status is an allowlist entry, not a substring of a job name.
//
// The defect: `informational: (.name | test("informational"))` in the workflow, and
// `jobName.includes('informational')` before that. A rename could silently turn a
// real gate advisory, and the GUI jobs live in a *different workflow run* that the
// ci.yml attribution job never sees at all.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  INFORMATIONAL_JOBS,
  auditAllowlist,
  informationalFor,
  summariseCollection,
} from './ci-informational.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

test('an allowlisted job is informational and says why', () => {
  const entry = informationalFor('.github/workflows/native-gui-e2e.yml', 'Windows GUI E2E (informational)')
  assert.equal(entry.informational, true)
  assert.equal(entry.known, true)
  assert.ok(entry.why.length > 10, 'an entry without a reason becomes permanent by accident')
  assert.ok(entry.removeWhen.length > 10, 'an entry without a removal condition is forever')
})

test('a job that merely says "informational" is NOT informational', () => {
  // The spoof. Adding a workflow file named this must not demote a gate.
  const entry = informationalFor('.github/workflows/ci.yml', 'Rust quality (informational)')
  assert.equal(entry.informational, false)
  assert.equal(entry.known, false)
})

test('a job name is only informational in its own workflow', () => {
  // The same name in a different workflow file is a different job.
  const entry = informationalFor('.github/workflows/ci.yml', 'Windows GUI E2E (informational)')
  assert.equal(entry.informational, false)
})

test('an unclassified job is blocking, and the report can say it is unknown', () => {
  const entry = informationalFor('.github/workflows/ci.yml', 'A brand new job')
  assert.equal(entry.informational, false)
  assert.equal(entry.known, false, 'unknown must be distinguishable from deliberately-blocking')
})

test('the allowlist matches the workflows it describes', () => {
  // Drift detector. Adding `continue-on-error: true` to a job, or removing it, without
  // updating the allowlist fails here rather than in a live report.
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/native-gui-e2e.yml'), 'utf8')
  const names = extractJobNames(workflow)
  const { declared, stale } = auditAllowlist('.github/workflows/native-gui-e2e.yml', names)

  const informationalInWorkflow = names.filter(name => /\(informational\)/i.test(name))
  for (const name of informationalInWorkflow) {
    const found = declared.find(entry => entry.job === name)
    assert.ok(found?.informational, `${name} contains "(informational)" but is not allowlisted`)
  }
  assert.deepEqual(stale, [], 'allowlist entries that no longer exist must be removed')
})

test('every allowlist entry names a reason and a removal condition', () => {
  for (const entry of INFORMATIONAL_JOBS) {
    assert.ok(entry.workflow.startsWith('.github/workflows/'), entry.job)
    assert.ok(entry.job.length > 0)
    assert.ok(typeof entry.why === 'string' && entry.why.length > 10, `${entry.job} needs a why`)
    assert.ok(
      typeof entry.removeWhen === 'string' && entry.removeWhen.length > 10,
      `${entry.job} needs a removeWhen`,
    )
  }
})

test('a sibling workflow that did not run is NOT_COLLECTED, never a pass', () => {
  const summary = summariseCollection({
    selfRun: { runId: 1 },
    siblings: [{ workflow: '.github/workflows/native-gui-e2e.yml', run: null, reason: 'path filter' }],
  })
  assert.equal(summary.self.status, 'COLLECTED')
  const sibling = summary.siblings[0]
  assert.equal(sibling.status, 'NOT_COLLECTED')
  assert.notEqual(sibling.status, 'COLLECTED')
  assert.ok(sibling.reason.length > 0)
})

test('a sibling workflow that ran is collected with its run id', () => {
  const summary = summariseCollection({
    selfRun: { runId: 1 },
    siblings: [{ workflow: '.github/workflows/native-gui-e2e.yml', run: { id: 99 } }],
  })
  assert.equal(summary.siblings[0].status, 'COLLECTED')
  assert.equal(summary.siblings[0].runId, 99)
})

/** Pull job display names out of a workflow file without a YAML dependency. */
function extractJobNames(yaml) {
  const names = []
  const jobsBlock = yaml.split(/^jobs:\s*$/m)[1] ?? ''
  for (const line of jobsBlock.split('\n')) {
    const match = /^\s{4}name:\s*(.+?)\s*$/.exec(line)
    if (match) names.push(match[1].replace(/^['"]|['"]$/g, ''))
  }
  return names
}
