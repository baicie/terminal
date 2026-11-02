import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  BINARY_BINDING,
  checkVerificationEvidence,
  DEBUG_SSH_CASES,
  EVIDENCE_MANIFEST_FILE,
  FINGERPRINT_PATHS,
  findProfileHashConflicts,
  findRecordedHashes,
  groupEvidenceByProfile,
  MISSING_MANIFEST_MESSAGE,
  RELEASE_SSH_CASES,
} from './check-verification-evidence.mjs'

const RELEASE_COLD_START = '2026-10-11-macos-release-terminal-gate.json'
const RELEASE_SSH_MATRIX = '2026-10-11-macos-release-ssh-matrix.json'
const RELEASE_SECOND = RELEASE_SSH_MATRIX
const DEBUG_COLD_START = '2026-10-11-macos-cold-start-current.json'
const DEBUG_REMOTE = '2026-10-11-macos-remote-shell-prompt-rerun.json'
const DEBUG_SSH_MATRIX = '2026-10-11-macos-ssh-matrix-current.json'
const DEBUG_SHELL = '2026-10-11-macos-shell-interaction-current.json'

// The six current files are one CI run's output. These fixtures describe such a
// run explicitly, because the gate now binds the files to that run's manifest
// instead of to a binary on this machine.
const RUN_ID = '4242424242'
const CURRENT_SOURCE = 'fingerprint-of-current-source'
const DEBUG_SHA = 'd'.repeat(64)
const RELEASE_SHA = 'e'.repeat(64)

// The two executables the evidence must name, at the fixed paths the gate reads.
const DEBUG_ARTIFACT = 'src-tauri/target/debug/terminal'
const RELEASE_ARTIFACT = 'src-tauri/target/release/terminal'

const RAW_LOGS = [
  'debug-local-cold-start.log',
  'debug-remote-cold-start.log',
  'debug-ssh-matrix.log',
  'debug-shell-probe-local.log',
  'debug-shell-probe-ssh.log',
  'release-local-cold-start.log',
  'release-ssh-matrix.log',
]

// Every file the gate registers as current. Tests that are not about a missing
// file supply all of them so an unrelated absence cannot leak into their
// assertions.
const ALL_CURRENT = [
  DEBUG_COLD_START,
  DEBUG_REMOTE,
  DEBUG_SSH_MATRIX,
  DEBUG_SHELL,
  RELEASE_COLD_START,
  RELEASE_SSH_MATRIX,
]

const PROFILE_BY_FILE = new Map([
  [DEBUG_COLD_START, 'debug'],
  [DEBUG_REMOTE, 'debug'],
  [DEBUG_SSH_MATRIX, 'debug'],
  [DEBUG_SHELL, 'debug'],
  [RELEASE_COLD_START, 'release'],
  [RELEASE_SSH_MATRIX, 'release'],
])

const KIND_BY_FILE = new Map([
  [DEBUG_COLD_START, 'tauri-process-cold-start-stopwatch-current-worktree'],
  [DEBUG_REMOTE, 'tauri-remote-cold-start-shell-prompt-observed-rerun'],
  [DEBUG_SSH_MATRIX, 'tauri-real-ssh-matrix-current-worktree'],
  [DEBUG_SHELL, 'tauri-local-shell-interaction-current-worktree'],
  [RELEASE_COLD_START, 'tauri-release-ten-second-terminal-gate'],
  [RELEASE_SSH_MATRIX, 'tauri-release-ssh-and-shell-matrix'],
])

// The case lists are imported, not restated: a copied contract drifts the
// moment either side changes, and the failure then looks like a broken gate.

const SHELL_PROBE_CASES = [
  'cat-eof',
  'readline-history',
  'readline-tab',
  'vim-edit',
  'nano-edit',
  'pty-resize',
  'ctrl-c-interrupt',
]

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
    'scripts/build-verification-evidence.mjs',
    'scripts/fetch-verification-evidence.mjs',
  ])
})

function manifestFor(overrides = {}) {
  const base = {
    source: 'github-actions',
    runId: RUN_ID,
    runAttempt: '1',
    workflow: 'Real-machine terminal matrix',
    job: 'macos-ssh-matrix',
    commit: 'f'.repeat(40),
    fingerprint: CURRENT_SOURCE,
    debugSha: DEBUG_SHA,
    releaseSha: RELEASE_SHA,
    runner: { os: 'macOS', arch: 'ARM64' },
    ...overrides,
  }
  // The generator writes one evidenceFiles entry per file from the two profile
  // pins. Deriving them the same way keeps a test that re-pins one profile from
  // disagreeing with the list and hiding which check actually fired.
  if (overrides.evidenceFiles === undefined) {
    base.evidenceFiles = ALL_CURRENT.map(file => {
      const profile = PROFILE_BY_FILE.get(file)
      return {
        file,
        profile,
        kind: KIND_BY_FILE.get(file),
        sha256: profile === 'debug' ? base.debugSha : base.releaseSha,
      }
    })
  }
  if (overrides.rawLogs === undefined) {
    base.rawLogs = { directory: 'evidence-logs', files: [...RAW_LOGS] }
  }
  return base
}

function createHarness({
  files = {},
  manifest,
  omit = [],
  omitManifest = false,
  evidenceFingerprint = CURRENT_SOURCE,
  shas = { debug: DEBUG_SHA, release: RELEASE_SHA },
  rawLogs = RAW_LOGS,
} = {}) {
  const present = new Set(ALL_CURRENT)
  for (const file of omit) present.delete(file)
  if (!omitManifest) present.add(EVIDENCE_MANIFEST_FILE)
  const contents = new Map()
  for (const file of present) {
    if (file === EVIDENCE_MANIFEST_FILE) continue
    // Registered files a test did not write still have to be readable,
    // otherwise the harness would report them as unparsable and every assertion
    // about a different problem would be drowned out.
    contents.set(
      file,
      files[file] ??
        validEvidence(
          file,
          shas[PROFILE_BY_FILE.get(file)],
          evidenceFingerprint,
        ),
    )
  }
  const manifestText =
    manifest === undefined ? JSON.stringify(manifestFor()) : manifest
  return {
    availableFiles: [...present],
    dependencies: {
      readdir: async directory =>
        String(directory).split(path.sep).includes('raw')
          ? [...rawLogs]
          : [...present],
      readFile: async filePath => {
        if (filePath.endsWith(EVIDENCE_MANIFEST_FILE)) return manifestText
        const name = [...contents.keys()].find(file => filePath.endsWith(file))
        if (name) return contents.get(name)
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      },
    },
  }
}

function validEvidence(file, sha256, sourceFingerprint = CURRENT_SOURCE) {
  const value = {
    kind: KIND_BY_FILE.get(file),
    provenance: {
      source: 'github-actions',
      runId: RUN_ID,
      runAttempt: '1',
      workflow: 'Real-machine terminal matrix',
      job: 'macos-ssh-matrix',
      commit: 'f'.repeat(40),
      fingerprint: sourceFingerprint,
      runner: { os: 'macOS', arch: 'ARM64' },
    },
  }
  // The measured executable is named at the fixed path the gate reads: debug
  // evidence under binary.*, release evidence under build.*.
  if (PROFILE_BY_FILE.get(file) === 'debug') {
    value.binary = { path: DEBUG_ARTIFACT, sha256 }
    value.source = { fingerprint: sourceFingerprint }
  } else {
    value.build = {
      command: 'VITE_TERMINAL_SMOKE_BUILD=1 pnpm tauri build --no-bundle',
      binary: RELEASE_ARTIFACT,
      sha256,
    }
  }
  if (file === DEBUG_COLD_START) {
    value.measurement = {
      terminalRuns: [
        { readyAt: 'terminal', terminalReady: true, markerReady: true, spawnToReadyMs: 1200 },
        { readyAt: 'terminal', terminalReady: true, markerReady: true, spawnToReadyMs: 1300 },
        { readyAt: 'terminal', terminalReady: true, markerReady: true, spawnToReadyMs: 1400 },
      ],
    }
  }
  if (file === RELEASE_COLD_START) {
    value.local = {
      terminalRuns: [
        { readyAt: 'terminal', terminalReady: true, markerReady: true, spawnToReadyMs: 1200 },
        { readyAt: 'terminal', terminalReady: true, markerReady: true, spawnToReadyMs: 1300 },
        { readyAt: 'terminal', terminalReady: true, markerReady: true, spawnToReadyMs: 1400 },
      ],
    }
  }
  if (file === DEBUG_REMOTE) {
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
    value.cases = DEBUG_SSH_CASES.map(name => ({ name, ok: true }))
  }
  if (file === DEBUG_SHELL) {
    value.allCasesPassed = true
    value.matrixRunsExecuted = 14
    value.matrixRunsPassed = 14
    value.sshRunsExecuted = 7
    value.sshRunsPassed = 7
    value.cases = ['bash', 'zsh'].flatMap(shell =>
      SHELL_PROBE_CASES.map(testCase => ({ shell, case: testCase, ok: true })),
    )
    value.sshCases = SHELL_PROBE_CASES.map(testCase => ({ case: testCase, ok: true }))
  }
  if (file === RELEASE_SSH_MATRIX) {
    value.sshMatrix = {
      passed: RELEASE_SSH_CASES.length,
      failed: 0,
      cases: RELEASE_SSH_CASES.map(name => ({ name, ok: true })),
    }
  }
  return JSON.stringify(value)
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

test('passes when the manifest binds all six files to one CI run', async () => {
  const { problems, checked } = await checkVerificationEvidence(createHarness())
  assert.deepEqual(problems, [])
  // Every registered file is checked; none may be silently skipped.
  assert.equal(checked, ALL_CURRENT.length)
})

test('fails when the manifest is missing', async () => {
  // The six files cannot be validated on their own any more: without the run
  // that produced them there is nothing to bind the recorded artifact hashes to.
  const { problems } = await checkVerificationEvidence(
    createHarness({ omitManifest: true }),
  )
  assert.ok(problems.includes(MISSING_MANIFEST_MESSAGE), JSON.stringify(problems))
  // The message has to name the way out instead of leaving the reader stuck.
  assert.match(MISSING_MANIFEST_MESSAGE, /fetch-verification-evidence\.mjs/)
})

test('fails when the manifest fingerprint no longer matches the tree', async () => {
  const { problems } = await checkVerificationEvidence({
    ...createHarness({
      evidenceFingerprint: 'fingerprint-of-new-source',
      manifest: JSON.stringify(
        manifestFor({ fingerprint: 'fingerprint-of-old-source' }),
      ),
    }),
    sourceFingerprint: 'fingerprint-of-new-source',
  })
  assert.equal(problems.length, 1, JSON.stringify(problems))
  assert.match(problems[0], /was produced from source fingerprint/)
})

test('fails when the manifest pins an artifact the evidence does not record', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness({
      manifest: JSON.stringify(manifestFor({ debugSha: 'c'.repeat(64) })),
    }),
  )
  // All four debug files still record the debug artifact the run built.
  assert.equal(problems.length, 4, JSON.stringify(problems))
  for (const problem of problems) {
    assert.match(problem, /binds the debug artifact of run/)
  }
})

test('fails when an evidence file comes from a different run than the manifest', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness({ manifest: JSON.stringify(manifestFor({ runId: '9999' })) }),
  )
  assert.equal(problems.length, ALL_CURRENT.length, JSON.stringify(problems))
  for (const problem of problems) {
    assert.match(problem, /come from different runs/)
  }
})

test('fails when a current evidence file carries no provenance', async () => {
  const withoutProvenance = JSON.parse(validEvidence(DEBUG_SSH_MATRIX, DEBUG_SHA))
  delete withoutProvenance.provenance
  const { problems } = await checkVerificationEvidence(
    createHarness({ files: { [DEBUG_SSH_MATRIX]: JSON.stringify(withoutProvenance) } }),
  )
  assert.equal(problems.length, 1, JSON.stringify(problems))
  assert.match(problems[0], /carries no provenance block/)
})

test('fails when one profile mixes binaries from separate runs', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness({
      files: {
        [RELEASE_SSH_MATRIX]: validEvidence(RELEASE_SSH_MATRIX, 'a'.repeat(64)),
      },
    }),
  )
  // The matrix is both internally inconsistent with the cold-start file and no
  // longer the artifact the manifest binds, so both problems are reported.
  assert.equal(problems.length, 2, JSON.stringify(problems))
  assert.ok(
    problems.some(problem =>
      /release evidence disagrees on the measured binary/.test(problem),
    ),
  )
  assert.ok(
    problems.some(problem => /binds the release artifact of run/.test(problem)),
  )
})

test('does not compare different profiles against each other', async () => {
  const { problems } = await checkVerificationEvidence(createHarness())
  assert.deepEqual(problems, [])
})

test('fails when a registered current evidence file is missing from disk', async () => {
  // The gate used to filter the registered files down to the ones that happen
  // to exist, so deleting an evidence file silently reduced coverage instead of
  // failing. A reviewer would see a passing gate that no longer checks the
  // release binary at all.
  const { problems } = await checkVerificationEvidence(
    createHarness({ omit: [RELEASE_COLD_START] }),
  )
  assert.equal(problems.length, 1, JSON.stringify(problems))
  assert.match(problems[0], /registered as current evidence but are missing/)
  assert.ok(problems[0].includes(RELEASE_COLD_START))
})

test('fails when a current evidence file records no hash', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness({
      files: {
        [RELEASE_COLD_START]: JSON.stringify({
          kind: KIND_BY_FILE.get(RELEASE_COLD_START),
          binary: {},
          provenance: { runId: RUN_ID },
          local: {
            terminalRuns: Array.from({ length: 3 }, () => ({
              readyAt: 'terminal',
              terminalReady: true,
              spawnToReadyMs: 1200,
            })),
          },
        }),
      },
    }),
  )
  assert.ok(problems.some(problem => /record no binary sha256/.test(problem)))
})

test('fails closed on unparsable evidence instead of skipping it', async () => {
  const { problems } = await checkVerificationEvidence(
    createHarness({ files: { [RELEASE_COLD_START]: '{ not json' } }),
  )
  assert.ok(problems.some(problem => /not valid JSON/.test(problem)))
  assert.ok(problems.some(problem => /record no binary sha256/.test(problem)))
})

test('ignores evidence files that are not tracked as current', async () => {
  const { problems, checked } = await checkVerificationEvidence(
    createHarness({
      files: {
        '2026-09-22-macos-input-probe.json': JSON.stringify({
          binary: { sha256: 'old-1' },
        }),
      },
    }),
  )
  assert.deepEqual(problems, [])
  // The extra historical file is not registered, so it is not counted, but all
  // six registered ones still are.
  assert.equal(checked, ALL_CURRENT.length)
})

test('fails when the recorded source fingerprint no longer matches the tree', async () => {
  // Debug evidence also carries its own fingerprint. Without that per-file
  // statement a file could keep an older fingerprint and ride along on a fresh
  // manifest, so the gate checks both.
  const { problems } = await checkVerificationEvidence({
    ...createHarness({
      files: {
        [DEBUG_COLD_START]: validEvidence(
          DEBUG_COLD_START,
          DEBUG_SHA,
          'fingerprint-of-old-source',
        ),
        [DEBUG_SSH_MATRIX]: validEvidence(
          DEBUG_SSH_MATRIX,
          DEBUG_SHA,
          'fingerprint-of-old-source',
        ),
      },
    }),
    sourceFingerprint: CURRENT_SOURCE,
  })

  assert.equal(problems.length, 2, JSON.stringify(problems))
  for (const problem of problems) {
    assert.match(problem, /source fingerprint/)
    assert.match(problem, /Re-run the scenario/)
  }
})

test('passes when the recorded source fingerprint still matches the tree', async () => {
  const { problems } = await checkVerificationEvidence({
    ...createHarness(),
    sourceFingerprint: CURRENT_SOURCE,
  })
  assert.deepEqual(problems, [])
})

test('fails closed when debug evidence omits its source fingerprint', async () => {
  const withoutFingerprint = JSON.parse(validEvidence(DEBUG_COLD_START, DEBUG_SHA))
  delete withoutFingerprint.source
  const { problems } = await checkVerificationEvidence({
    ...createHarness({
      files: { [DEBUG_COLD_START]: JSON.stringify(withoutFingerprint) },
    }),
    sourceFingerprint: CURRENT_SOURCE,
  })
  assert.ok(problems.some(problem => /missing source fingerprint/.test(problem)))
})

test('rejects window readiness, slow runs, and incomplete repeated terminal samples', async () => {
  const slowEvidence = JSON.parse(validEvidence(DEBUG_COLD_START, DEBUG_SHA))
  slowEvidence.measurement.terminalRuns[1].spawnToReadyMs = 10_001
  slowEvidence.measurement.terminalRuns.pop()
  const { problems } = await checkVerificationEvidence({
    ...createHarness({
      files: { [DEBUG_COLD_START]: JSON.stringify(slowEvidence) },
    }),
    sourceFingerprint: CURRENT_SOURCE,
  })

  assert.ok(problems.some(problem => /at least 3 terminal marker runs/.test(problem)))
  assert.ok(problems.some(problem => /exceeds 10000 ms/.test(problem)))
})

test('rejects a current SSH matrix with a missing expected case', async () => {
  const matrix = JSON.parse(validEvidence(DEBUG_SSH_MATRIX, DEBUG_SHA))
  matrix.cases.pop()
  const { problems } = await checkVerificationEvidence({
    ...createHarness({ files: { [DEBUG_SSH_MATRIX]: JSON.stringify(matrix) } }),
    sourceFingerprint: CURRENT_SOURCE,
  })
  assert.ok(problems.some(problem => /SSH matrix case set/.test(problem)))
})

test('rejects current evidence with an unexpected kind', async () => {
  const matrix = JSON.parse(validEvidence(DEBUG_SSH_MATRIX, DEBUG_SHA))
  matrix.kind = 'unrelated-evidence'
  const { problems } = await checkVerificationEvidence({
    ...createHarness({ files: { [DEBUG_SSH_MATRIX]: JSON.stringify(matrix) } }),
    sourceFingerprint: CURRENT_SOURCE,
  })
  assert.ok(problems.some(problem => /expected kind/.test(problem)))
})
test('reads the artifact binding from one fixed path per profile', () => {
  // The binding is a fixed path, not a search: these are the only fields that
  // can state which executable a file measured.
  assert.deepEqual([...BINARY_BINDING], [
    [
      'debug',
      {
        shaPath: ['binary', 'sha256'],
        pathPath: ['binary', 'path'],
        artifactPath: DEBUG_ARTIFACT,
      },
    ],
    [
      'release',
      {
        shaPath: ['build', 'sha256'],
        pathPath: ['build', 'binary'],
        artifactPath: RELEASE_ARTIFACT,
      },
    ],
  ])
})

test('rejects a debug evidence file whose binary hash was edited', async () => {
  const tampered = JSON.parse(validEvidence(DEBUG_COLD_START, DEBUG_SHA))
  tampered.binary.sha256 = 'a'.repeat(64)
  const { problems } = await checkVerificationEvidence({
    ...createHarness({
      files: { [DEBUG_COLD_START]: JSON.stringify(tampered) },
    }),
    sourceFingerprint: CURRENT_SOURCE,
  })
  const binding = problems.find(problem =>
    problem.startsWith(`debug evidence ${DEBUG_COLD_START}:`),
  )
  assert.ok(binding, JSON.stringify(problems))
  assert.match(binding, /binds the debug artifact of run 4242424242/)
  assert.ok(binding.includes('a'.repeat(64)))
  assert.ok(problems.some(problem =>
    /disagrees on the measured binary/.test(problem),
  ))
})

test('rejects a correct sha256 planted in an unrelated field', async () => {
  // This is the tampering the old anywhere-in-the-document rule accepted: the
  // field that names the measured binary says one thing, an unrelated note
  // carries the digest the manifest expects, so the binding passed.
  const planted = JSON.parse(validEvidence(DEBUG_SSH_MATRIX, DEBUG_SHA))
  planted.binary.sha256 = 'b'.repeat(64)
  planted.note = {
    sha256: DEBUG_SHA,
    description: 'superseded reference kept for the audit trail',
  }
  assert.ok(findRecordedHashes(planted).includes(DEBUG_SHA))

  const { problems } = await checkVerificationEvidence({
    ...createHarness({
      files: { [DEBUG_SSH_MATRIX]: JSON.stringify(planted) },
    }),
    sourceFingerprint: CURRENT_SOURCE,
  })
  const binding = problems.find(problem =>
    problem.startsWith(`debug evidence ${DEBUG_SSH_MATRIX}:`),
  )
  assert.ok(binding, JSON.stringify(problems))
  assert.match(binding, /binds the debug artifact of run 4242424242/)

  // Deleting the binding field and keeping the planted digest is the same
  // attack without the awkward mismatch: an absent binding is a failure, not a
  // fallback to what the rest of the document happens to say.
  const withoutBinding = JSON.parse(validEvidence(DEBUG_SSH_MATRIX, DEBUG_SHA))
  delete withoutBinding.binary
  withoutBinding.note = { sha256: DEBUG_SHA }
  const second = await checkVerificationEvidence({
    ...createHarness({
      files: { [DEBUG_SSH_MATRIX]: JSON.stringify(withoutBinding) },
    }),
    sourceFingerprint: CURRENT_SOURCE,
  })
  assert.equal(second.problems.length, 1, JSON.stringify(second.problems))
  assert.match(
    second.problems[0],
    /binary\.sha256 is null instead of a sha256 digest/,
  )
})

test('rejects an evidence file whose runId differs from the manifest', async () => {
  const tampered = JSON.parse(validEvidence(DEBUG_SHELL, DEBUG_SHA))
  tampered.provenance.runId = '4242424243'
  const { problems } = await checkVerificationEvidence(
    createHarness({ files: { [DEBUG_SHELL]: JSON.stringify(tampered) } }),
  )
  assert.equal(problems.length, 1, JSON.stringify(problems))
  assert.match(problems[0], /come from different runs/)
  assert.ok(problems[0].includes(DEBUG_SHELL))
})

test('rejects release evidence recorded against an older source fingerprint', async () => {
  // Release evidence states its fingerprint only in provenance.fingerprint, so
  // without that statement being checked on its own a release record of an
  // older checkout rides along on a fresh manifest.
  const stale = JSON.parse(validEvidence(RELEASE_SSH_MATRIX, RELEASE_SHA))
  stale.provenance.fingerprint = 'fingerprint-of-old-source'
  const { problems } = await checkVerificationEvidence({
    ...createHarness({
      files: { [RELEASE_SSH_MATRIX]: JSON.stringify(stale) },
    }),
    sourceFingerprint: CURRENT_SOURCE,
  })
  assert.equal(problems.length, 1, JSON.stringify(problems))
  assert.match(
    problems[0],
    /recorded against source fingerprint fingerprint-of-old-source \(provenance\.fingerprint\)/,
  )
  assert.match(problems[0], /Re-run the scenario/)
})

test('rejects a manifest whose raw log is missing from the archive', async () => {
  const absent = 'debug-ssh-matrix.log'
  const { problems, checked } = await checkVerificationEvidence(
    createHarness({ rawLogs: RAW_LOGS.filter(name => name !== absent) }),
  )
  assert.equal(problems.length, 1, JSON.stringify(problems))
  assert.match(problems[0], /raw log\(s\) of run 4242424242 are missing/)
  assert.match(problems[0], /docs\/verification\/raw\/4242424242\//)
  assert.ok(problems[0].includes(absent))
  assert.equal(checked, ALL_CURRENT.length)
})

test('rejects a manifest that lists no raw log at all', async () => {
  const withoutLogs = manifestFor()
  delete withoutLogs.rawLogs
  const { problems } = await checkVerificationEvidence(
    createHarness({ manifest: JSON.stringify(withoutLogs) }),
  )
  assert.equal(problems.length, 1, JSON.stringify(problems))
  assert.match(problems[0], /records no rawLogs\.files/)
})

test('rejects a manifest that lists no per-file evidence entry', async () => {
  const withoutEntries = manifestFor()
  delete withoutEntries.evidenceFiles
  const { problems } = await checkVerificationEvidence(
    createHarness({ manifest: JSON.stringify(withoutEntries) }),
  )
  assert.equal(problems.length, ALL_CURRENT.length, JSON.stringify(problems))
  for (const problem of problems) {
    assert.match(problem, /records no evidenceFiles entry for this file/)
  }
})
