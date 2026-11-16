// T17 — the GUI workflow must run when the code its specs drive changes.
//
// Measured before the fix: the `paths:` filter listed `e2e/gui/**`, three scripts, one
// probe file and `src-tauri/**`. The specs assert on `activity-rail`, `app-sidebar`,
// `connection-explorer`, `terminal-workbench`, `right-panel` and the SFTP dock's
// `file-row` — all of which live in `packages/frontend/src/{components,view,router,store}`.
// Editing any of them produced **no GUI run**, and neither did editing the workflow
// file itself.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const GUI_WORKFLOW = readFileSync(path.join(ROOT, '.github/workflows/native-gui-e2e.yml'), 'utf8')

function pathsFilter(yaml) {
  const lines = yaml.split('\n')
  const start = lines.findIndex(line => /^\s{2}pull_request:\s*$/.test(line))
  assert.ok(start !== -1, 'the GUI workflow no longer has a pull_request trigger')

  const entries = []
  let inPaths = false
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    // A new top-level key (two-space indent, not a list item) ends the block.
    if (/^\s{2}[A-Za-z_-]+:/.test(line)) break
    if (/^\s{4}paths:\s*$/.test(line)) {
      inPaths = true
      continue
    }
    if (!inPaths) continue
    // Comment lines inside the block are skip-worthy, not terminators — the original
    // extractor treated the first comment as the end of the list and found nothing.
    const item = /^\s{6}-\s+(.+?)\s*$/.exec(line)
    if (item) entries.push(item[1].replace(/^['"]|['"]$/g, '').replace(/\s+#.*$/, ''))
  }
  assert.ok(entries.length > 0, 'the paths filter is empty')
  return entries
}

/**
 * Does a repository path match a `paths:` entry?
 *
 * GitHub's filter uses glob patterns with `**` for any depth. This is a faithful-enough
 * implementation for the patterns this repository uses (literal paths and `dir/**`),
 * which is why it is a small explicit matcher rather than a glob dependency.
 */
function matches(pattern, file) {
  if (pattern.endsWith('/**')) {
    return file.startsWith(pattern.slice(0, -3) + '/')
  }
  return pattern === file
}

test('editing the GUI workflow triggers the GUI workflow', () => {
  // The gate that cannot be edited without being re-run.
  const paths = pathsFilter(GUI_WORKFLOW)
  assert.ok(
    paths.some(pattern => matches(pattern, '.github/workflows/native-gui-e2e.yml')),
    'a PR that edits this workflow must trigger it',
  )
})

test('a change to any UI area the specs drive triggers the GUI workflow', () => {
  const paths = pathsFilter(GUI_WORKFLOW)
  // Real files that exist in the tree, chosen because the specs assert on them.
  const mustTrigger = [
    'packages/frontend/src/components/app-sidebar/index.tsx',
    'packages/frontend/src/store/app.ts',
    'packages/frontend/src/router/index.tsx',
    'packages/frontend/src/view/hosts/index.tsx',
    'packages/frontend/src/features/terminal/gui-e2e-probe.ts',
    'src-tauri/tauri.conf.json',
    'src-tauri/src/commands.rs',
    'e2e/gui/specs/e2e-01-startup.e2e.mjs',
    'scripts/run-gui-e2e.mjs',
  ]
  for (const file of mustTrigger) {
    assert.ok(
      paths.some(pattern => matches(pattern, file)),
      `${file} is driven by the GUI specs but does not trigger the GUI workflow`,
    )
  }
})

test('a docs-only change does not trigger the GUI workflow', () => {
  const paths = pathsFilter(GUI_WORKFLOW)
  for (const file of ['docs/phase10/01-current-state-audit.md', 'README.md', 'AGENTS.md']) {
    assert.ok(
      !paths.some(pattern => matches(pattern, file)),
      `${file} must not spend a 45-minute macOS runner`,
    )
  }
})

/**
 * Split the `jobs:` block into per-job chunks.
 *
 * By indentation, not by blank lines or a regex lookahead: a job's own properties and
 * its `steps:` list contain lines at many depths, and a naive split attributed one
 * job's `continue-on-error` to its neighbour.
 */
function jobBlocks(yaml) {
  const lines = yaml.split('\n')
  const start = lines.findIndex(line => /^jobs:\s*$/.test(line))
  assert.ok(start !== -1, 'no jobs block')
  const blocks = []
  let current = null
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    const jobKey = /^(\s{2})([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobKey) {
      if (current) blocks.push(current)
      current = { key: jobKey[2], lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }
  if (current) blocks.push(current)
  return blocks.map(block => {
    const text = block.lines.join('\n')
    // Only the job's OWN `continue-on-error`, at property depth (four spaces), not one
    // nested inside a step.
    const topLevel = block.lines.filter(line => !/^\s{6,}/.test(line)).join('\n')
    return {
      key: block.key,
      name: /^\s{4}name:\s*(.+?)\s*$/m.exec(topLevel)?.[1]?.replace(/^['"]|['"]$/g, '') ?? block.key,
      continueOnError: /^\s{4}continue-on-error:\s*true\s*$/m.test(topLevel),
      text,
    }
  })
}

test('the blocking/informational split is unchanged', () => {
  // The task's rule: do not remove `continue-on-error` to make CI green before a
  // platform has a stable pass record. This test makes removing it a deliberate act.
  assert.match(GUI_WORKFLOW, /name: Driver isolation gate/, 'the isolation gate must exist')
  assert.match(GUI_WORKFLOW, /name: macOS GUI E2E$|\n\s{4}name: macOS GUI E2E\n/m, 'macOS must be blocking')
  for (const platform of ['Windows', 'Linux']) {
    assert.match(
      GUI_WORKFLOW,
      new RegExp(`name: ${platform} GUI E2E \\(informational\\)`),
      `${platform} must stay marked informational`,
    )
  }

  // And the informational jobs must be the ones with continue-on-error.
  for (const job of jobBlocks(GUI_WORKFLOW)) {
    const informational = /\(informational\)/.test(job.name)
    assert.equal(
      job.continueOnError,
      informational,
      `${job.name}: continue-on-error=${job.continueOnError} but informational=${informational}`,
    )
  }
})

test('macOS is the only platform currently asserted blocking', () => {
  // Stated explicitly so adding a platform to the blocking set is a visible change.
  const blocking = jobBlocks(GUI_WORKFLOW)
    .filter(job => !job.continueOnError)
    .map(job => job.name)
  assert.deepEqual(blocking, ['Driver isolation gate', 'macOS GUI E2E'])
})
