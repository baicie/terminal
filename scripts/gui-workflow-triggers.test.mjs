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

test('GUI prompt assertions are not POSIX-only', async () => {
  // Measured on the Windows runner: the terminal had mounted and the buffer contained
  // `PS C:\Users\runneradmin>` while every readiness case timed out with
  // `no shell prompt ever appeared in the terminal buffer`. The assertions tested
  // `/[$#%]/` — the POSIX prompt set. PowerShell and cmd end their prompt with `>`.
  //
  // The screenshot from that run shows a fully working UI (status bar
  // `Connected · Local · 120×40`, a real echo round-trip), so the failure was the
  // assertion's platform assumption rather than the product.
  const { readdirSync } = await import('node:fs')
  const specsDir = path.join(ROOT, 'e2e/gui/specs')
  const offenders = []
  for (const name of readdirSync(specsDir).filter(n => n.endsWith('.e2e.mjs'))) {
    const source = readFileSync(path.join(specsDir, name), 'utf8')
    for (const line of source.split('\n')) {
      // A bare POSIX-only prompt character class used as a *test*, not mentioned in prose.
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(line)
      if (!isComment && /\/\[\$#%\]\//.test(line)) {
        offenders.push(`${name}: ${line.trim()}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a prompt assertion without `>` cannot pass on Windows PowerShell or cmd:\n' +
      offenders.join('\n'),
  )
})

test('a spec that resizes below the breakpoint does not require the status bar', () => {
  // `useIsMobile()` is `innerWidth < BREAKPOINTS.md` (640) and `main-layout-content.tsx`
  // renders `isMobile ? <BottomNav /> : <StatusBar />`. So at 640px and below there is no
  // `[data-testid="status-bar"]` in the DOM — the product's responsive behaviour, not a
  // defect.
  //
  // Measured: `e2e-02`'s matrix includes 640 and failed with
  // `status bar never became readable … last text: null` while every wider width passed.
  const source = readFileSync(path.join(ROOT, 'e2e/gui/specs/e2e-02-layout.e2e.mjs'), 'utf8')

  // The breakpoint constant must match the product's, or the guard silently drifts.
  const productBreakpoints = readFileSync(
    path.join(ROOT, 'packages/frontend/src/hooks/use-breakpoint.ts'),
    'utf8',
  )
  const mdMatch = /\bmd:\s*(\d+)/.exec(productBreakpoints)
  assert.ok(mdMatch, 'the product breakpoint table is missing `md`')
  const specBreakpoint = /const MOBILE_BREAKPOINT_PX = (\d+)/.exec(source)
  assert.ok(specBreakpoint, 'the spec must define the mobile breakpoint it special-cases')
  assert.equal(
    Number(specBreakpoint[1]),
    Number(mdMatch[1]),
    'the spec\'s breakpoint must equal the product\'s `md` breakpoint',
  )

  // The narrow widths in the matrix must be covered by the special case.
  const widths = /const WIDTHS = \[([^\]]+)\]/.exec(source)
  assert.ok(widths, 'the width matrix is missing')
  const narrow = widths[1]
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => value <= Number(mdMatch[1]))
  assert.ok(narrow.length > 0, 'this guard is pointless if the matrix has no narrow width')
  assert.match(
    source,
    /width <= MOBILE_BREAKPOINT_PX/,
    'every narrow width must take the terminal-geometry path instead of reading the bar',
  )
})

// DDQ14 — the production-bundle gate must scan a directory that exists.
//
// ## The defect, measured by the audit
//
// `ci.yml` grepped `packages/frontend/dist` for the smoke-only Vault probe marker. That
// path **does not exist** — `packages/frontend/vite.config.ts` sets `outDir: '../../dist'`,
// so the build lands at the repository root. `grep` returns non-zero for a missing path,
// `if` reads that as "no match", and the gate passed for every build since it was written.
//
// A gate that cannot find what it is supposed to scan has not cleared it.
const ciYaml = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
const viteConfig = readFileSync(path.join(ROOT, 'packages/frontend/vite.config.ts'), 'utf8')

test('the Vault-probe gate greps the directory vite actually writes', () => {
  const outDir = /outDir:\s*'([^']+)'/.exec(viteConfig)
  assert.ok(outDir, 'vite.config.ts must declare an outDir')
  const resolved = path.normalize(path.join('packages/frontend', outDir[1])).replace(/\/$/, '')
  assert.equal(resolved, 'dist', `the build writes to ${resolved}, so the gate must scan it`)
  assert.ok(
    ciYaml.includes('grep -r "phase9.7-vault-one-time" dist'),
    'the gate must grep that directory',
  )
})

test('the Vault-probe gate fails when it cannot find the directory', () => {
  /*
   * The old shape was `if grep …; then fail; fi` — a missing path makes `grep` non-zero
   * and the `if` treats it as "clean". The fix asserts the directory first.
   */
  assert.match(
    ciYaml,
    /test -d dist \|\|/,
    'the gate must refuse to pass when dist/ is absent, or it silently scans nothing',
  )
})
