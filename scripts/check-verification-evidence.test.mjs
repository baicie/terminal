import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  checkVerificationEvidence,
  FINGERPRINT_PATHS,
  findProfileHashConflicts,
  findRecordedHashes,
  groupEvidenceByProfile,
  reviewedHashForProfile,
} from './check-verification-evidence.mjs'

// The release profile is one consolidated gate file today. The second name is a
// fixture stand-in so the multi-file conflict scenarios keep exercising a
// profile that spans two records.
const RELEASE_COLD_START = '2026-10-11-macos-release-terminal-gate.json'
const RELEASE_SSH_MATRIX = '2026-10-11-macos-release-ssh-matrix.json'
const RELEASE_SECOND = RELEASE_SSH_MATRIX
const DEBUG_COLD_START = '2026-10-11-macos-cold-start-current.json'
const DEBUG_SSH_MATRIX = '2026-10-11-macos-ssh-matrix-current.json'

// Debug evidence is pinned to the reviewed build recorded in the gate. Read it
// from the gate instead of copying it, so moving the reviewed hash after a
// re-run does not turn these fixtures into a second, stale source of truth.
const REVIEWED_DEBUG = reviewedHashForProfile('debug')

// Every file the gate registers as current. Tests that are not about a
// missing file supply all of them so an unrelated absence cannot leak into
// their assertions.
const ALL_CURRENT = [
  DEBUG_COLD_START,
  '2026-10-11-macos-remote-shell-prompt-rerun.json',
  DEBUG_SSH_MATRIX,
  '2026-10-11-macos-shell-interaction-current.json',
  RELEASE_COLD_START,
  RELEASE_SSH_MATRIX,
]

const PROFILE_BY_FILE = new Map([
  [DEBUG_COLD_START, 'debug'],
  ['2026-10-11-macos-remote-shell-prompt-rerun.json', 'debug'],
  [DEBUG_SSH_MATRIX, 'debug'],
  ['2026-10-11-macos-shell-interaction-current.json', 'debug'],
  [RELEASE_COLD_START, 'release'],
  [RELEASE_SSH_MATRIX, 'release'],
])

const KIND_BY_FILE = new Map([
  [DEBUG_COLD_START, 'tauri-process-cold-start-stopwatch-current-worktree'],
  [
    '2026-10-11-macos-remote-shell-prompt-rerun.json',
    'tauri-remote-cold-start-shell-prompt-observed-rerun',
  ],
  [DEBUG_SSH_MATRIX, 'tauri-real-ssh-matrix-current-worktree'],
  [
    '2026-10-11-macos-shell-interaction-current.json',
    'tauri-local-shell-interaction-current-worktree',
  ],
  [RELEASE_COLD_START, 'tauri-release-ten-second-terminal-gate'],
  [RELEASE_SSH_MATRIX, 'tauri-release-ssh-and-shell-matrix'],
])

const CURRENT_SOURCE = 'fingerprint-of-current-source'

test('fingerprints the acceptance runner closure and real-machine workflow', () => {
  assert.deepEqual(FINGERPRINT_PATHS, [
    'packages/frontend/src',
    'packages/frontend/index.html',
    'packages/frontend/vite.config.ts',
    'packages/frontend/tsconfig.json',
    'packages/frontend/tsconfig.node.json',
    'src-tauri/src',
    'src-tauri/capabilities',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
    'src-tauri/tauri.conf.json',
    'src-tauri/build.rs',
    'packages/frontend/package.json',
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'rust-toolchain.toml',
    '.github/workflows/real-machine-matrix.yml',
    'scripts/macos-ax-probe.swift',
    'scripts/macos-frontmost.mjs',
    'scripts/input-probe-scenarios.mjs',
    'scripts/input-probe-source.mjs',
    'scripts/run-cold-start-stopwatch.mjs',
    'scripts/run-local-cold-start-stopwatch.mjs',
    'scripts/run-input-probe.mjs',
    'scripts/run-remote-cold-start-stopwatch.mjs',
    'scripts/run-terminal-shell-probe-matrix.mjs',
    'scripts/run-terminal-shell-probe.mjs',
    'scripts/run-terminal-smoke-matrix.mjs',
    'scripts/run-terminal-smoke.mjs',
    'scripts/terminal-smoke-password-sshd.mjs',
    'scripts/terminal-smoke-renderer-heartbeat.mjs',
    'scripts/terminal-smoke-sshd.mjs',
    'scripts/check-verification-evidence.mjs',
  ])
})

function createHarness(files, binaries = {}, { omit = [] } = {}) {
  const present = new Set([...ALL_CURRENT, ...Object.keys(files)])
  const omitted = new Set(omit)
  for (const file of omitted) present.delete(file)
  // Registered files a test did not write still have to be readable, otherwise
  // the harness would report them as unparsable and every assertion about a
  // different problem would be drowned out.
  const contents = new Map()
  for (const file of present) {
    // Release fixtures default to the binary the harness reports on disk, so a
    // test that is not about release staleness does not trip that check.
    contents.set(
      file,
      files[file] ??
        validEvidence(
          file,
          PROFILE_BY_FILE.get(file) === 'release'
            ? hashOf('release-1')
            : REVIEWED_DEBUG,
        ),
    )
  }
  for (const file of omitted) contents.delete(file)
  return {
    availableFiles: [...present],
    dependencies: {
      readdir: async () => [...present],
      readFile: async filePath => {
        const name = [...contents.keys()].find(file => filePath.endsWith(file))
        if (name) return contents.get(name)
        for (const [suffix, contents] of Object.entries(binaries)) {
          if (filePath.endsWith(suffix)) {
            if (contents === null) {
              const error = new Error('missing')
              error.code = 'ENOENT'
              throw error
            }
            return contents
          }
        }
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      },
    },
  }
}

function evidence(sha256) {
  return JSON.stringify({ binary: { sha256 } })
}

// Debug evidence records the source fingerprint alongside the binary hash,
// because its artifact cannot be compared against what `pnpm verify` leaves on
// disk. See Issue #75.
function sourceEvidence(file, sha256, sourceFingerprint) {
  return validEvidence(file, sha256, sourceFingerprint)
}

function validEvidence(file, sha256, sourceFingerprint = CURRENT_SOURCE) {
  const value = {
    kind: KIND_BY_FILE.get(file),
    binary: { sha256 },
  }
  if (PROFILE_BY_FILE.get(file) === 'debug') {
    value.source = { fingerprint: sourceFingerprint }
  }
  if (file === DEBUG_COLD_START) {
    value.measurement = {
      terminalRuns: [
        { readyAt: 'terminal', terminalReady: true, spawnToReadyMs: 1200 },
        { readyAt: 'terminal', terminalReady: true, spawnToReadyMs: 1300 },
        { readyAt: 'terminal', terminalReady: true, spawnToReadyMs: 1400 },
      ],
    }
  }
  if (file === RELEASE_COLD_START) {
    value.local = {
      terminalRuns: [
        { readyAt: 'terminal', terminalReady: true, spawnToReadyMs: 1200 },
        { readyAt: 'terminal', terminalReady: true, spawnToReadyMs: 1300 },
        { readyAt: 'terminal', terminalReady: true, spawnToReadyMs: 1400 },
      ],
    }
  }
  if (file === '2026-10-11-macos-remote-shell-prompt-rerun.json') {
    value.measurement = {
      readyAt: 'terminal',
      terminalReady: true,
      markerReady: true,
      underTenSeconds: true,
      spawnToPromptObservedMs: 1400,
    }
  }
  if (file === DEBUG_SSH_MATRIX) {
    value.allCasesPassed = true
    value.cases = [
      'key',
      'key-reconnect',
      'key-outage-reconnect',
      'key-outage-wake-reconnect',
      'key-first-connect-outage',
      'password',
      'password-reconnect',
      'agent',
      'agent-reconnect',
      'cert',
      'cert-reconnect',
      'jump',
      'jump-reconnect',
    ].map(name => ({ name }))
    value.cases = value.cases.map(item => ({ ...item, ok: true }))
  }
  if (file === '2026-10-11-macos-shell-interaction-current.json') {
    value.allCasesPassed = true
    value.matrixRunsExecuted = 14
    value.matrixRunsPassed = 14
    value.sshRunsExecuted = 7
    value.sshRunsPassed = 7
    value.cases = ['bash', 'zsh'].flatMap(shell =>
      [
        'cat-eof',
        'readline-history',
        'readline-tab',
        'vim-edit',
        'nano-edit',
        'pty-resize',
        'ctrl-c-interrupt',
      ].map(testCase => ({ shell, case: testCase, ok: true })),
    )
    value.sshCases = [
      'cat-eof',
      'readline-history',
      'readline-tab',
      'vim-edit',
      'nano-edit',
      'pty-resize',
      'ctrl-c-interrupt',
    ].map(testCase => ({ case: testCase, ok: true }))
  }
  if (file === RELEASE_SSH_MATRIX) {
    const names = [
      'key',
      'key-reconnect',
      'password',
      'password-reconnect',
      'agent',
      'agent-reconnect',
      'cert',
      'cert-reconnect',
      'jump',
      'jump-reconnect',
    ]
    value.sshMatrix = {
      passed: 10,
      failed: 0,
      cases: names.map(name => ({
        name,
        ok: true,
      })),
    }
  }
  return JSON.stringify(value)
}

// The gate hashes the artifact it finds on disk, so the harness must hash the
// same way or every profile would look stale.
function hashOf(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

test('collects every recorded sha256 in an evidence document', () => {
  assert.deepEqual(
    findRecordedHashes({
      binary: { sha256: 'aaa' },
      superseded: { earlierBinary: 'ignored', currentBinary: 'ignored' },
      cases: [{ binary: { sha256: 'aaa' } }, { binary: { sha256: 'bbb' } }],
    }),
    ['aaa', 'bbb'],
  )
  assert.deepEqual(findRecordedHashes({}), [])
})

test('groups evidence by build profile', () => {
  const groups = groupEvidenceByProfile([
    [DEBUG_COLD_START, 'debug'],
    [DEBUG_SSH_MATRIX, 'debug'],
    [RELEASE_COLD_START, 'release'],
  ])
  assert.deepEqual(groups.get('debug'), [DEBUG_COLD_START, DEBUG_SSH_MATRIX])
  assert.deepEqual(groups.get('release'), [RELEASE_COLD_START])
})

test('reports no conflict when one profile agrees on a single binary', () => {
  const conflicts = findProfileHashConflicts(
    new Map([['release', [RELEASE_COLD_START, RELEASE_SECOND]]]),
    new Map([
      [RELEASE_COLD_START, ['aaa']],
      [RELEASE_SECOND, ['aaa']],
    ]),
  )
  assert.deepEqual(conflicts, [])
})

test('flags a profile whose evidence spans two binaries', () => {
  const conflicts = findProfileHashConflicts(
    new Map([['release', [RELEASE_COLD_START, RELEASE_SECOND]]]),
    new Map([
      [RELEASE_COLD_START, ['aaa']],
      [RELEASE_SECOND, ['bbb']],
    ]),
  )
  assert.equal(conflicts.length, 1)
  assert.deepEqual(conflicts[0].hashes, ['aaa', 'bbb'])
})

test('passes when each profile is internally consistent', async () => {
  const { problems, checked } = await checkVerificationEvidence(
    createHarness(
      {
        [RELEASE_COLD_START]: validEvidence(RELEASE_COLD_START, hashOf('release-1')),
        [RELEASE_SECOND]: validEvidence(RELEASE_SECOND, hashOf('release-1')),
        [DEBUG_COLD_START]: validEvidence(DEBUG_COLD_START, REVIEWED_DEBUG),
        [DEBUG_SSH_MATRIX]: validEvidence(DEBUG_SSH_MATRIX, REVIEWED_DEBUG),
      },
      {
        'target/release/terminal': 'release-1',
        'target/debug/terminal': 'debug-1',
      },
    ),
  )
  assert.deepEqual(problems, [])
  // Every registered file is now checked; none may be silently skipped.
  assert.equal(checked, ALL_CURRENT.length)
})

test('fails when one profile mixes binaries from separate runs', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness(
      {
        [RELEASE_COLD_START]: validEvidence(RELEASE_COLD_START, hashOf('release-1')),
        [RELEASE_SECOND]: validEvidence(RELEASE_SECOND, hashOf('release-2')),
      },
      {
        'target/release/terminal': 'release-1',
        'target/debug/terminal': 'debug-1',
      },
    ),
  )
  // The matrix file is both internally inconsistent with the cold-start file
  // and no longer describes the binary on disk, so both problems are reported.
  assert.equal(problems.length, 2, JSON.stringify(problems))
  assert.ok(
    problems.some(problem =>
      /release evidence disagrees on the measured binary/.test(problem),
    ),
  )
  assert.ok(
    problems.some(problem =>
      /does not describe the binary on disk/.test(problem),
    ),
  )
})

test('does not compare different profiles against each other', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness(
      {
        [RELEASE_COLD_START]: validEvidence(RELEASE_COLD_START, hashOf('release-1')),
        [DEBUG_COLD_START]: validEvidence(DEBUG_COLD_START, REVIEWED_DEBUG),
      },
      {
        'target/release/terminal': 'release-1',
        'target/debug/terminal': 'debug-1',
      },
    ),
  )
  assert.deepEqual(problems, [])
})

test('fails when a registered current evidence file is missing from disk', async () => {
  // The gate used to filter the registered files down to the ones that happen
  // to exist, so deleting an evidence file silently reduced coverage instead of
  // failing. A reviewer would see a passing gate that no longer checks the
  // release binary at all.
  const { problems } = await checkVerificationEvidence(
    createHarness(
      {
        [DEBUG_COLD_START]: validEvidence(DEBUG_COLD_START, REVIEWED_DEBUG),
        [DEBUG_SSH_MATRIX]: validEvidence(DEBUG_SSH_MATRIX, REVIEWED_DEBUG),
      },
      {
        'target/release/terminal': 'release-1',
        'target/debug/terminal': 'debug-1',
      },
      { omit: [RELEASE_COLD_START] },
    ),
  )
  assert.equal(problems.length, 1, JSON.stringify(problems))
  assert.match(problems[0], /registered as current evidence but are missing/)
  assert.ok(problems[0].includes(RELEASE_COLD_START))
})

test('fails when a current evidence file records no hash', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness(
      { [RELEASE_COLD_START]: JSON.stringify({ binary: {} }) },
      {
        'target/release/terminal': 'release-1',
        'target/debug/terminal': 'debug-1',
      },
    ),
  )
  assert.ok(problems.some(problem => /record no binary sha256/.test(problem)))
})

test('fails closed on unparsable evidence instead of skipping it', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness(
      { [RELEASE_COLD_START]: '{ not json' },
      {
        'target/release/terminal': 'release-1',
        'target/debug/terminal': 'debug-1',
      },
    ),
  )
  assert.ok(problems.some(problem => /not valid JSON/.test(problem)))
  assert.ok(problems.some(problem => /record no binary sha256/.test(problem)))
})

test('ignores evidence files that are not tracked as current', async () => {
  const { problems, checked } = await checkVerificationEvidence(
    createHarness(
      {
        '2026-09-22-macos-input-probe.json': evidence('old-1'),
        [RELEASE_COLD_START]: validEvidence(RELEASE_COLD_START, hashOf('release-1')),
      },
      {
        'target/release/terminal': 'release-1',
        'target/debug/terminal': 'debug-1',
      },
    ),
  )
  assert.deepEqual(problems, [])
  // The extra historical file is not registered, so it is not counted, but all
  // six registered ones still are.
  assert.equal(checked, ALL_CURRENT.length)
})

test('fails when current evidence describes a binary that is no longer on disk', async () => {
  const harness = createHarness(
    {
      // Both release files agree with each other on an older build, so the
      // only problem is that neither describes what is on disk now.
      [RELEASE_COLD_START]: validEvidence(RELEASE_COLD_START, hashOf('an-older-release')),
      [RELEASE_SSH_MATRIX]: validEvidence(RELEASE_SSH_MATRIX, hashOf('an-older-release')),
    },
    {
      'target/release/terminal': 'the-current-release',
      'target/debug/terminal': 'debug-1',
    },
  )
  const { problems, checked } = await checkVerificationEvidence(harness)
  assert.equal(
    checked,
    ALL_CURRENT.length,
    'the stale file must be tracked as current evidence',
  )

  assert.equal(problems.length, 2, JSON.stringify(problems))
  for (const problem of problems) {
    assert.match(problem, /does not describe the binary on disk/)
    assert.match(problem, /Re-run the scenario/)
  }
})

test('fails closed when the profile binary has not been built', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness(
      { [RELEASE_COLD_START]: validEvidence(RELEASE_COLD_START, hashOf('release-1')) },
      { 'target/release/terminal': null, 'target/debug/terminal': 'debug-1' },
    ),
  )

  assert.equal(problems.length, 1)
  assert.match(problems[0], /the binary is not built/)
})

test('fails when the recorded source fingerprint no longer matches the tree', async () => {
  // The debug profile cannot be checked against the artifact on disk, because
  // `pnpm verify` relinks target/debug as a bare cargo build. Without a source
  // fingerprint the gate therefore cannot see that the terminal frontend
  // changed after the debug evidence was recorded, and the evidence keeps
  // reading as current while describing code that no longer exists.
  const { problems } = await checkVerificationEvidence({
    ...createHarness(
      {
        [DEBUG_COLD_START]: sourceEvidence(
          DEBUG_COLD_START,
          REVIEWED_DEBUG,
          'fingerprint-of-old-source',
        ),
        [DEBUG_SSH_MATRIX]: sourceEvidence(
          DEBUG_SSH_MATRIX,
          REVIEWED_DEBUG,
          'fingerprint-of-old-source',
        ),
      },
      { 'target/release/terminal': 'release-1' },
    ),
    sourceFingerprint: 'fingerprint-of-new-source',
  })

  assert.equal(problems.length, 4, JSON.stringify(problems))
  for (const problem of problems) {
    assert.match(problem, /source fingerprint/)
    assert.match(problem, /Re-run the scenario/)
  }
})

test('passes when the recorded source fingerprint still matches the tree', async () => {
  const { problems } = await checkVerificationEvidence({
    ...createHarness(
      {
        [DEBUG_COLD_START]: sourceEvidence(
          DEBUG_COLD_START,
          REVIEWED_DEBUG,
          'fingerprint-of-current-source',
        ),
        [DEBUG_SSH_MATRIX]: sourceEvidence(
          DEBUG_SSH_MATRIX,
          REVIEWED_DEBUG,
          'fingerprint-of-current-source',
        ),
      },
      { 'target/release/terminal': 'release-1' },
    ),
    sourceFingerprint: 'fingerprint-of-current-source',
  })

  assert.deepEqual(problems, [])
})

test('fails closed when debug evidence omits its source fingerprint', async () => {
  const { problems } = await checkVerificationEvidence({
    ...createHarness(
      {
        [DEBUG_COLD_START]: JSON.stringify({
          kind: KIND_BY_FILE.get(DEBUG_COLD_START),
          binary: { sha256: REVIEWED_DEBUG },
          measurement: {
            terminalRuns: Array.from({ length: 3 }, () => ({
              readyAt: 'terminal',
              terminalReady: true,
              spawnToReadyMs: 1200,
            })),
          },
        }),
      },
      { 'target/release/terminal': 'release-1' },
    ),
    sourceFingerprint: CURRENT_SOURCE,
  })

  assert.ok(problems.some(problem => /missing source fingerprint/.test(problem)))
})

test('rejects window readiness, slow runs, and incomplete repeated terminal samples', async () => {
  const slowEvidence = JSON.parse(
    validEvidence(DEBUG_COLD_START, REVIEWED_DEBUG),
  )
  slowEvidence.measurement.terminalRuns[1].spawnToReadyMs = 10_001
  slowEvidence.measurement.terminalRuns.pop()
  const { problems } = await checkVerificationEvidence({
    ...createHarness(
      { [DEBUG_COLD_START]: JSON.stringify(slowEvidence) },
      { 'target/release/terminal': 'release-1' },
    ),
    sourceFingerprint: CURRENT_SOURCE,
  })

  assert.ok(problems.some(problem => /at least 3 terminal marker runs/.test(problem)))
  assert.ok(problems.some(problem => /exceeds 10000 ms/.test(problem)))
})

test('rejects a current SSH matrix with a missing expected case', async () => {
  const matrix = JSON.parse(validEvidence(DEBUG_SSH_MATRIX, REVIEWED_DEBUG))
  matrix.cases.pop()
  const { problems } = await checkVerificationEvidence({
    ...createHarness(
      { [DEBUG_SSH_MATRIX]: JSON.stringify(matrix) },
      { 'target/release/terminal': 'release-1' },
    ),
    sourceFingerprint: CURRENT_SOURCE,
  })

  assert.ok(problems.some(problem => /SSH matrix case set/.test(problem)))
})

test('rejects current evidence with an unexpected kind', async () => {
  const matrix = JSON.parse(validEvidence(DEBUG_SSH_MATRIX, REVIEWED_DEBUG))
  matrix.kind = 'unrelated-evidence'
  const { problems } = await checkVerificationEvidence({
    ...createHarness(
      { [DEBUG_SSH_MATRIX]: JSON.stringify(matrix) },
      { 'target/release/terminal': 'release-1' },
    ),
    sourceFingerprint: CURRENT_SOURCE,
  })

  assert.ok(problems.some(problem => /expected kind/.test(problem)))
})
