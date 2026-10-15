import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertShellsAvailable,
  casesForShell,
  selectShellProbeCases,
  shellProbeFilterFromArguments,
  shellProbeReusesBinary,
  shellProbeShellsFromArguments,
  shellProbeTransportFromArguments,
} from './run-terminal-shell-probe-matrix.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')

/**
 * Reads the per-dialect case lists straight out of the frontend's leaf module,
 * which is the single source of truth the probe parser enforces. This runner is
 * plain Node and cannot import that TypeScript module, so the contract test
 * asserts the two lists stay identical instead of duplicating the logic.
 */
async function declaredDialectCases() {
  const source = await readFile(
    path.join(
      projectRoot,
      'packages/frontend/src/experiments/terminal-shell-probe/dialect-cases.ts',
    ),
    'utf8',
  )
  const result = {}
  for (const dialect of ['powershell', 'cmd']) {
    const match = new RegExp(dialect + ':\\s*\\[([^\\]]*)\\]').exec(source)
    assert.ok(match, 'dialect ' + dialect + ' must declare its case list')
    result[dialect] = match[1]
      .split(',')
      .map(entry => entry.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
  }
  return result
}

test('selects all shell interaction cases by default and preserves matrix order', () => {
  assert.deepEqual(selectShellProbeCases(), [
    'cat-eof',
    'readline-history',
    'readline-tab',
    'vim-edit',
    'nano-edit',
    'pty-resize',
    'ctrl-c-interrupt',
  ])
  assert.deepEqual(selectShellProbeCases('readline-tab,cat-eof'), [
    'cat-eof',
    'readline-tab',
  ])
})

test('rejects unknown shell interaction matrix cases', () => {
  assert.throws(
    () => selectShellProbeCases('readline-history,unknown'),
    /unknown shell probe case/,
  )
})

test('ignores the package argument separator before selecting a case filter', () => {
  assert.equal(
    shellProbeFilterFromArguments(['--', 'cat-eof,readline-tab']),
    'cat-eof,readline-tab',
  )
  assert.equal(shellProbeFilterFromArguments(['--']), undefined)
})

test('ignores the release option before selecting a case filter', () => {
  assert.equal(
    shellProbeFilterFromArguments(['--release', 'cat-eof,readline-tab']),
    'cat-eof,readline-tab',
  )
  assert.equal(
    shellProbeFilterFromArguments(['--release']),
    undefined,
    'a flag-only invocation must select every case',
  )
})

test('selects explicitly requested shells independently from probe cases', () => {
  assert.deepEqual(
    shellProbeShellsFromArguments([
      '--shells',
      'bash,zsh,fish',
      'cat-eof,readline-history,readline-tab',
    ]),
    ['bash', 'zsh', 'fish'],
  )
  assert.deepEqual(shellProbeShellsFromArguments(['--release']), [undefined])
})

test('rejects malformed or unknown shell matrix options', () => {
  assert.throws(
    () => shellProbeShellsFromArguments(['--shells']),
    /--shells requires a comma-separated value/,
  )
  assert.throws(
    () => shellProbeShellsFromArguments(['--shells', 'bash,unknown']),
    /unknown shell probe shell/,
  )
})

test('reuses an existing instrumented binary only when requested', () => {
  assert.equal(shellProbeReusesBinary([]), false)
  assert.equal(shellProbeReusesBinary(['--reuse-binary']), true)
  assert.equal(
    shellProbeFilterFromArguments(['--reuse-binary']),
    undefined,
  )
})

test('fails closed when an explicitly requested shell is unavailable', () => {
  assert.throws(
    () =>
      assertShellsAvailable(['bash', 'zsh', 'fish'], {
      isAvailable: shell => shell !== 'fish',
      }),
    /requested shell executable\(s\) unavailable: fish/,
  )
  assert.doesNotThrow(
    () => assertShellsAvailable([undefined], { isAvailable: () => false }),
    'the default shell is selected by the application and is not preflighted',
  )
  assert.doesNotThrow(() =>
    assertShellsAvailable(['bash', 'zsh'], { isAvailable: () => true }),
  )
})

test('defaults to the local transport and parses an explicit one', () => {
  assert.equal(shellProbeTransportFromArguments([]), 'local')
  assert.equal(shellProbeTransportFromArguments(['--release']), 'local')
  assert.equal(
    shellProbeTransportFromArguments(['--transport', 'ssh']),
    'ssh',
  )
})

test('rejects an unknown or valueless transport', () => {
  assert.throws(
    () => shellProbeTransportFromArguments(['--transport']),
    /--transport requires local or ssh/,
  )
  assert.throws(
    () => shellProbeTransportFromArguments(['--transport', 'serial']),
    /unknown shell probe transport/,
  )
})

test('never treats the transport value as the positional case filter', () => {
  // Without skipping the option value, 'ssh' would be parsed as a case name and
  // the run would fail with a confusing "unknown shell probe case".
  assert.equal(shellProbeFilterFromArguments(['--transport', 'ssh']), undefined)
  assert.equal(
    shellProbeFilterFromArguments(['--transport', 'ssh', 'cat-eof']),
    'cat-eof',
  )
})

test('--shells accepts the Windows dialects so the Windows job can request them', () => {
  // The Windows dialects are reachable only through --shells. If the validator
  // kept checking the POSIX list alone, `--shells powershell` would fail before
  // any case ran and the dialect could never be exercised on any platform.
  assert.deepEqual(shellProbeShellsFromArguments(['--shells', 'powershell']), [
    'powershell',
  ])
  assert.deepEqual(shellProbeShellsFromArguments(['--shells', 'cmd']), ['cmd'])
  assert.deepEqual(
    shellProbeShellsFromArguments(['--shells', 'powershell,cmd']),
    ['powershell', 'cmd'],
  )
})

test('--shells still rejects a shell no dialect defines', () => {
  assert.throws(
    () => shellProbeShellsFromArguments(['--shells', 'nope']),
    /unknown shell probe shell 'nope'/,
  )
})

test('the Windows dialect case filters in the workflow match the dialect table', async () => {
  // Mirrors .github/workflows/real-machine-matrix.yml. A mismatch here would
  // only surface as a CI failure on a Windows runner, minutes into a build, so
  // the workflow filters are compared against the frontend's own dialect table.
  const filters = {
    powershell: ['cat-eof', 'pty-resize', 'ctrl-c-interrupt'],
    cmd: ['cat-eof', 'ctrl-c-interrupt'],
  }
  const declared = await declaredDialectCases()
  for (const [shell, requested] of Object.entries(filters)) {
    assert.deepEqual(casesForShell(shell, requested), requested)
    // Every requested case must be one the frontend dialect actually claims,
    // and the filter must not quietly drop a case the dialect does claim.
    assert.deepEqual(requested, declared[shell])
  }
})
