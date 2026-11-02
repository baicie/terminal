import { readdir, readFile, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Guards the recorded acceptance evidence against a failure mode that is
 * invisible when reading a single evidence file: two current evidence files can
 * describe different binaries while both read as authoritative.
 *
 * The six current files are produced by one GitHub Actions macOS run (see
 * .github/workflows/real-machine-matrix.yml and
 * scripts/build-verification-evidence.mjs). They are therefore bound to
 * docs/verification/evidence-manifest.json - the fingerprint, the two artifact
 * hashes and the run id of that run - instead of to a binary on this machine.
 *
 * That binding replaced a comparison against the binary on disk because a CI
 * build and a local build of the same sources are not guaranteed to be
 * bit-identical: relinking target/debug with a different toolchain or feature
 * set already produced different bytes for identical sources, so "the file on
 * my disk must equal the file in CI" could only ever be true for the one
 * machine that happened to run the capture. Binding to the artifacts of the
 * same run keeps the guarantee that matters (evidence and binary belong
 * together) without pretending the bytes are reproducible.
 *
 * Historical records are deliberately exempt from that binding: they document
 * the binary that existed at the time, which is the reason they are kept.
 */

const projectRoot = path.resolve(import.meta.dirname, '..')
const verificationRoot = path.join(projectRoot, 'docs', 'verification')

export const EVIDENCE_PROFILE = new Map([
  ['2026-10-11-macos-cold-start-current.json', 'debug'],
  ['2026-10-11-macos-remote-shell-prompt-rerun.json', 'debug'],
  ['2026-10-11-macos-ssh-matrix-current.json', 'debug'],
  ['2026-10-11-macos-shell-interaction-current.json', 'debug'],
  ['2026-10-11-macos-release-terminal-gate.json', 'release'],
  ['2026-10-11-macos-release-ssh-matrix.json', 'release'],
])

export const EVIDENCE_KIND = new Map([
  ['2026-10-11-macos-cold-start-current.json', 'tauri-process-cold-start-stopwatch-current-worktree'],
  ['2026-10-11-macos-remote-shell-prompt-rerun.json', 'tauri-remote-cold-start-shell-prompt-observed-rerun'],
  ['2026-10-11-macos-ssh-matrix-current.json', 'tauri-real-ssh-matrix-current-worktree'],
  ['2026-10-11-macos-shell-interaction-current.json', 'tauri-local-shell-interaction-current-worktree'],
  ['2026-10-11-macos-release-terminal-gate.json', 'tauri-release-ten-second-terminal-gate'],
  ['2026-10-11-macos-release-ssh-matrix.json', 'tauri-release-ssh-and-shell-matrix'],
])

// The password and password-reconnect cases are deliberately outside this
// contract: the hosted macOS runners have no Docker, and the native loopback
// sshd the fixture can build there authenticates the client and then never
// sees a channel open, so those two cases cannot be measured on the platform
// that produces these files. They stay covered by the Linux job, which runs
// the same two cases against the Debian OpenSSH image (docs/issue.md #144);
// adding them back here is the one-line change once that is solved.
export const DEBUG_SSH_CASES = [
  'key',
  'key-reconnect',
  'key-outage-reconnect',
  'key-outage-wake-reconnect',
  'key-first-connect-outage',
  'agent',
  'agent-reconnect',
  'cert',
  'cert-reconnect',
  'jump',
  'jump-reconnect',
]

export const RELEASE_SSH_CASES = [
  'key',
  'key-reconnect',
  'agent',
  'agent-reconnect',
  'cert',
  'cert-reconnect',
  'jump',
  'jump-reconnect',
]

export const SHELL_PROBE_CASES = [
  'cat-eof',
  'readline-history',
  'readline-tab',
  'vim-edit',
  'nano-edit',
  'pty-resize',
  'ctrl-c-interrupt',
]

const MANIFEST_FILE = 'evidence-manifest.json'

export const EVIDENCE_MANIFEST_FILE = MANIFEST_FILE

// Which manifest field binds which build profile to the artifact of the run.
const PROFILE_MANIFEST_FIELD = new Map([
  ['debug', 'debugSha'],
  ['release', 'releaseSha'],
])

/**
 * Where each profile states which executable it measured. These are the only
 * fields the artifact binding reads, and every one of them is asserted against
 * the manifest and against a fixed artifact path.
 *
 * A sha256 found anywhere else in the document binds nothing: the gate used to
 * collect every field named sha256 from the whole tree and accept a match
 * anywhere, which a digest pasted into a note, a description or a fixture block
 * satisfied just as well as a real measurement - while the field that names the
 * measured binary could say something else entirely.
 */
export const BINARY_BINDING = new Map([
  [
    'debug',
    {
      shaPath: ['binary', 'sha256'],
      pathPath: ['binary', 'path'],
      artifactPath: 'src-tauri/target/debug/terminal',
    },
  ],
  [
    'release',
    {
      shaPath: ['build', 'sha256'],
      pathPath: ['build', 'binary'],
      artifactPath: 'src-tauri/target/release/terminal',
    },
  ],
])

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RAW_LOG_NAME_PATTERN = /^[A-Za-z0-9._-]+\.log$/

function readStringAt(record, keys) {
  let current = record
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return typeof current === 'string' ? current : undefined
}

function findManifestEntry(manifest, file) {
  const listed = Array.isArray(manifest?.evidenceFiles) ? manifest.evidenceFiles : []
  return listed.find(entry => entry?.file === file)
}

/**
 * Every sha256 anywhere in the document. It is kept for one narrow purpose -
 * noticing that a single file names two different binaries - and it is
 * deliberately not the artifact binding (see BINARY_BINDING).
 */
function collectHashes(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectHashes(item, found)
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'sha256' && typeof nested === 'string') found.push(nested)
      else collectHashes(nested, found)
    }
    return found
  }
  return found
}

export function findRecordedHashes(evidence) {
  return [...new Set(collectHashes(evidence))].sort()
}

export function findSourceFingerprint(evidence) {
  const fingerprint = evidence?.source?.fingerprint
  return typeof fingerprint === 'string' ? fingerprint : undefined
}

function validateColdStartRuns(file, evidence) {
  const runs =
    file === '2026-10-11-macos-release-terminal-gate.json'
      ? evidence.local?.terminalRuns
      : evidence.measurement?.terminalRuns
  const problems = []
  if (!Array.isArray(runs) || runs.length < 3) {
    problems.push(`${file} requires at least 3 terminal marker runs`)
  }
  for (const [index, run] of (Array.isArray(runs) ? runs : []).entries()) {
    if (run?.readyAt !== 'terminal' || run?.terminalReady !== true) {
      problems.push(`${file} run ${index + 1} is not terminal-ready marker evidence`)
    }
    if (
      !Number.isFinite(run?.spawnToReadyMs) ||
      run.spawnToReadyMs < 0 ||
      run.spawnToReadyMs > 10_000
    ) {
      problems.push(`${file} run ${index + 1} exceeds 10000 ms or has no valid timing`)
    }
  }
  return problems
}

function validateMatrixCases(file, evidence) {
  const problems = []
  if (file === '2026-10-11-macos-ssh-matrix-current.json') {
    const cases = Array.isArray(evidence.cases) ? evidence.cases : []
    const names = cases.map(item => item?.name)
    if (
      evidence.allCasesPassed !== true ||
      JSON.stringify(names) !== JSON.stringify(DEBUG_SSH_CASES) ||
      cases.some(item => item?.ok !== true)
    ) {
      problems.push(
        `${file} SSH matrix case set must contain all ${DEBUG_SSH_CASES.length} expected successful cases`,
      )
    }
  }
  if (file === '2026-10-11-macos-shell-interaction-current.json') {
    const shellCases = Array.isArray(evidence.cases) ? evidence.cases : []
    const sshCases = Array.isArray(evidence.sshCases) ? evidence.sshCases : []
    const localShellsComplete = ['bash', 'zsh'].every(shell => {
      const cases = shellCases
        .filter(item => item?.shell === shell)
        .map(item => item?.case)
      return (
        JSON.stringify(cases) === JSON.stringify(SHELL_PROBE_CASES) &&
        shellCases
          .filter(item => item?.shell === shell)
          .every(item => item?.ok === true)
      )
    })
    if (
      evidence.allCasesPassed !== true ||
      evidence.matrixRunsExecuted !== 14 ||
      evidence.matrixRunsPassed !== 14 ||
      shellCases.length !== 14 ||
      !localShellsComplete
    ) {
      problems.push(`${file} local shell matrix must report all 14 bash/zsh runs successful`)
    }
    if (
      evidence.sshRunsExecuted !== 7 ||
      evidence.sshRunsPassed !== 7 ||
      JSON.stringify(sshCases.map(item => item?.case)) !==
        JSON.stringify(SHELL_PROBE_CASES) ||
      sshCases.some(item => item?.ok !== true)
    ) {
      problems.push(`${file} real SSH shell matrix must report all 7 expected cases successful`)
    }
  }
  if (file === '2026-10-11-macos-release-ssh-matrix.json') {
    const matrix = evidence.sshMatrix
    const cases = Array.isArray(matrix?.cases) ? matrix.cases : []
    if (
      matrix?.passed !== RELEASE_SSH_CASES.length ||
      matrix?.failed !== 0 ||
      JSON.stringify(cases.map(item => item?.name)) !==
        JSON.stringify(RELEASE_SSH_CASES) ||
      cases.some(item => item?.ok !== true)
    ) {
      problems.push(
        `${file} release SSH matrix must report all ${RELEASE_SSH_CASES.length} expected successful cases`,
      )
    }
  }
  return problems
}

export function validateEvidenceContract(file, evidence) {
  const problems = []
  const expectedKind = EVIDENCE_KIND.get(file)
  if (evidence?.kind !== expectedKind) {
    problems.push(`${file} has kind ${JSON.stringify(evidence?.kind)}; expected kind ${JSON.stringify(expectedKind)}`)
  }
  if (EVIDENCE_PROFILE.get(file) === 'debug') {
    const fingerprint = findSourceFingerprint(evidence)
    if (!fingerprint) {
      problems.push(`debug evidence ${file} is missing source fingerprint`)
    }
  }
  if (
    file === '2026-10-11-macos-cold-start-current.json' ||
    file === '2026-10-11-macos-release-terminal-gate.json'
  ) {
    problems.push(...validateColdStartRuns(file, evidence ?? {}))
  }
  if (file === '2026-10-11-macos-remote-shell-prompt-rerun.json') {
    const measurement = evidence?.measurement
    if (
      measurement?.markerReady !== true ||
      !Number.isFinite(measurement?.spawnToPromptObservedMs) ||
      measurement.spawnToPromptObservedMs < 0 ||
      measurement.spawnToPromptObservedMs > 10_000
    ) {
      problems.push(`${file} requires a successful terminal marker within 10000 ms`)
    }
  }
  problems.push(...validateMatrixCases(file, evidence ?? {}))
  return problems
}

// Product sources and the executable acceptance path are both part of the
// evidence contract. Documentation, evidence records and test files are
// excluded so unrelated edits do not invalidate measurements.
export const FINGERPRINT_PATHS = [
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
  // The generator decides which numbers land in the evidence and the fetch
  // script decides which files land on disk, so both belong in the fingerprint
  // for the same reason the gate itself does.
  'scripts/build-verification-evidence.mjs',
  'scripts/fetch-verification-evidence.mjs',
]

const FINGERPRINT_IGNORED = new Set(['node_modules', 'dist', 'target', '.git'])

async function collectFingerprintFiles(relativePath, out) {
  let stats
  try {
    stats = await stat(path.join(projectRoot, relativePath))
  } catch {
    return out
  }
  if (stats.isFile()) {
    out.push(relativePath)
    return out
  }
  if (!stats.isDirectory()) return out
  for (const name of await readdir(path.join(projectRoot, relativePath))) {
    if (FINGERPRINT_IGNORED.has(name)) continue
    await collectFingerprintFiles(path.join(relativePath, name), out)
  }
  return out
}

/**
 * Fingerprints the product sources and the runner/workflow contract the macOS
 * acceptance evidence describes.
 *
 * Debug evidence cannot be validated against its artifact because `pnpm
 * verify` relinks target/debug as a bare cargo build, so the only way to notice
 * that a measurement predates a code change is to fingerprint the code
 * itself. Content hashing keeps this independent of mtimes, checkouts and
 * line endings.
 */
export async function computeSourceFingerprint(
  dependencies = { readdir, readFile, stat },
) {
  const files = []
  for (const root of FINGERPRINT_PATHS) {
    await collectFingerprintFiles(root, files)
  }
  files.sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update(await dependencies.readFile(path.join(projectRoot, file)))
  }
  return hash.digest('hex')
}

export function groupEvidenceByProfile(entries) {
  const groups = new Map()
  for (const [file, profile] of entries) {
    if (!groups.has(profile)) groups.set(profile, [])
    groups.get(profile).push(file)
  }
  return groups
}

export function findProfileHashConflicts(groups, hashesByFile) {
  const conflicts = []
  for (const [profile, files] of groups) {
    const observed = new Map()
    for (const file of files) {
      for (const hash of hashesByFile.get(file) ?? []) {
        if (!observed.has(hash)) observed.set(hash, [])
        observed.get(hash).push(file)
      }
    }
    if (observed.size > 1) {
      conflicts.push({
        profile,
        hashes: [...observed.keys()].sort(),
        files,
      })
    }
  }
  return conflicts
}

export const MISSING_MANIFEST_MESSAGE =
  `docs/verification/${MANIFEST_FILE} is missing. The six current evidence files are ` +
  'only valid together with the manifest of the CI run that produced them; nothing ' +
  'on this machine can replace it, because a local build and the CI build of the same ' +
  'sources are not guaranteed to be bit-identical. Fetch both with ' +
  '`node scripts/fetch-verification-evidence.mjs --latest` (or `--run-id <id>`) instead ' +
  'of writing an evidence file by hand.'

/**
 * Binds the six evidence files to the manifest of one CI run.
 *
 * Each check answers a failure that reading the evidence alone cannot see: a
 * manifest from another checkout, a field pinned by hand while the artifact
 * moved, or a file left over from a different run than the one the manifest
 * describes.
 */
/**
 * Asserts one evidence file against the artifact of the CI run, at the fixed
 * paths that name that artifact. Everything is reported as one problem for the
 * file, because a reviewer needs the sentence about this file rather than four
 * fragments about the same broken binding.
 */
function validateArtifactBinding(file, evidence, manifest) {
  const profile = EVIDENCE_PROFILE.get(file)
  const binding = BINARY_BINDING.get(profile)
  const field = PROFILE_MANIFEST_FIELD.get(profile)
  const expected =
    typeof manifest?.[field] === 'string' ? manifest[field] : undefined
  const recorded = readStringAt(evidence, binding.shaPath)
  const recordedPath = readStringAt(evidence, binding.pathPath)
  const listed = findManifestEntry(manifest, file)
  const detail = []

  if (recorded === undefined || !SHA256_PATTERN.test(recorded)) {
    detail.push(
      `${binding.shaPath.join('.')} is ${JSON.stringify(recorded ?? null)} ` +
        'instead of a sha256 digest',
    )
  }
  if (recorded !== expected) {
    detail.push(
      `it records ${JSON.stringify(recorded ?? null)} where ${MANIFEST_FILE} ` +
        `binds the ${profile} artifact of run ${manifest?.runId ?? '<none>'} to ` +
        `${JSON.stringify(expected ?? null)}`,
    )
  }
  if (recordedPath !== binding.artifactPath) {
    detail.push(
      `${binding.pathPath.join('.')} is ${JSON.stringify(recordedPath ?? null)} ` +
        `instead of ${binding.artifactPath}, so the file does not name the ` +
        'executable it measured',
    )
  }
  if (listed === undefined) {
    detail.push(`${MANIFEST_FILE} records no evidenceFiles entry for this file`)
  } else if (listed.sha256 !== recorded) {
    detail.push(
      `the ${MANIFEST_FILE} evidenceFiles entry for this file records ` +
        JSON.stringify(listed.sha256 ?? null),
    )
  }
  if (detail.length === 0) return []
  return [
    `${profile} evidence ${file}: ${detail.join('; ')}. Re-run the scenario on ` +
      'the artifact that run produced instead of citing numbers measured on a ' +
      'different build or written by hand.',
  ]
}

const RAW_LOG_DIRECTORY = 'docs/verification/raw'

/**
 * The raw log of a scenario is the audit trail behind its JSON numbers: the
 * summary states what was measured, the log is what shows it was measured at
 * all. A manifest naming logs nobody can open is not an audit trail.
 */
async function validateRawLogArchive(manifest, readDirectory) {
  const problems = []
  const listed = Array.isArray(manifest?.rawLogs?.files)
    ? manifest.rawLogs.files
    : []
  if (listed.length === 0) {
    problems.push(
      `${MANIFEST_FILE} records no rawLogs.files, so the logs behind these ` +
        'measurements cannot be opened. Install the manifest with ' +
        'scripts/fetch-verification-evidence.mjs instead of writing it by hand.',
    )
    return problems
  }
  const unusable = listed.filter(
    name => typeof name !== 'string' || !RAW_LOG_NAME_PATTERN.test(name),
  )
  if (unusable.length > 0) {
    problems.push(
      `${MANIFEST_FILE} lists raw log names that are not plain .log names: ` +
        `${unusable.map(name => JSON.stringify(name ?? null)).join(', ')}.`,
    )
  }
  const runId =
    typeof manifest.runId === 'string' && manifest.runId !== ''
      ? manifest.runId
      : undefined
  if (runId === undefined) return problems
  const usable = listed.filter(
    name => typeof name === 'string' && RAW_LOG_NAME_PATTERN.test(name),
  )
  let installed = []
  try {
    installed = await readDirectory(path.join(verificationRoot, 'raw', runId))
  } catch {
    installed = []
  }
  const present = new Set(installed.map(name => String(name)))
  const missing = usable.filter(
    name => !present.has(name) && !present.has(`${name}.gz`),
  )
  if (missing.length > 0) {
    problems.push(
      `the raw log(s) of run ${runId} are missing from ${RAW_LOG_DIRECTORY}/` +
        `${runId}/: ${missing.join(', ')}. The JSON numbers are a summary; the ` +
        'raw log is what shows they were measured rather than written. Restore ' +
        'them with scripts/fetch-verification-evidence.mjs (or store them as ' +
        '<name>.gz) instead of deleting the tail of the audit trail.',
    )
  }
  return problems
}
export function validateEvidenceManifest(
  manifest,
  { entries, evidenceByFile, sourceFingerprint },
) {
  const problems = []
  const runId = typeof manifest.runId === 'string' ? manifest.runId : undefined

  if (typeof manifest.fingerprint !== 'string' || manifest.fingerprint === '') {
    problems.push(
      `${MANIFEST_FILE} records no source fingerprint, so it cannot show which sources ` +
        'the run measured.',
    )
  } else if (
    sourceFingerprint !== undefined &&
    manifest.fingerprint !== sourceFingerprint
  ) {
    problems.push(
      `${MANIFEST_FILE} was produced from source fingerprint ${manifest.fingerprint}, but ` +
        `these sources fingerprint as ${sourceFingerprint}. The evidence describes a ` +
        'different checkout: dispatch the macOS evidence job on this commit instead of ' +
        'citing measurements taken before these sources existed.',
    )
  }

  if (runId === undefined || runId === '') {
    problems.push(
      `${MANIFEST_FILE} records no run id, so the evidence cannot be tied to the CI run ` +
        'that measured it.',
    )
  }

  for (const [profile, field] of PROFILE_MANIFEST_FIELD) {
    if (!entries.some(([file]) => EVIDENCE_PROFILE.get(file) === profile)) continue
    const expected = manifest[field]
    if (typeof expected !== 'string' || expected === '') {
      problems.push(
        `${MANIFEST_FILE} records no ${field}, so the ${profile} evidence is not bound to ` +
          'the artifact the run built.',
      )
    }
  }

  // One problem per file, read from the fixed paths in BINARY_BINDING. Accepting
  // a matching digest found anywhere in the document let a value pasted into an
  // unrelated field stand in for the binding, so each file is now asserted
  // against the manifest field of its profile, the manifest's own entry for it
  // and the path of the executable it claims to have measured.
  for (const [file] of entries) {
    problems.push(
      ...validateArtifactBinding(file, evidenceByFile.get(file), manifest),
    )
  }

  for (const [file] of entries) {
    const provenance = evidenceByFile.get(file)?.provenance
    if (provenance === null || typeof provenance !== 'object') {
      problems.push(
        `${file} carries no provenance block, so it is not a CI-produced record: ` +
          'scripts/build-verification-evidence.mjs writes that block from the run that ' +
          'measured the scenario.',
      )
      continue
    }
    if (runId !== undefined && provenance.runId !== runId) {
      problems.push(
        `${file} was produced by run ${JSON.stringify(provenance.runId)}, but ` +
          `${MANIFEST_FILE} describes run ${runId}: the evidence file and the manifest ` +
          'come from different runs. Fetch both from one run.',
      )
    }
  }

  return problems
}

export async function checkVerificationEvidence({
  dependencies = { readdir, readFile },
  availableFiles,
  sourceFingerprint,
} = {}) {
  const present =
    availableFiles ?? (await dependencies.readdir(verificationRoot))
  // Every registered file must exist. Filtering the registry down to whatever
  // happens to be on disk would make deleting an evidence file silently reduce
  // coverage: the gate would still pass while checking one profile less, and a
  // reviewer would have no signal that the proof had been removed.
  const registered = [...EVIDENCE_PROFILE]
  const absent = registered
    .map(([file]) => file)
    .filter(file => !present.includes(file))
  // Absent files are reported as problems above; they are not read or compared,
  // because there is nothing on disk to compare.
  const entries = registered.filter(([file]) => present.includes(file))
  const hashesByFile = new Map()
  const fingerprintsByFile = new Map()
  const evidenceByFile = new Map()
  const unparsable = []

  for (const [file] of entries) {
    const raw = await dependencies.readFile(
      path.join(verificationRoot, file),
      'utf8',
    )
    try {
      const parsed = JSON.parse(raw)
      evidenceByFile.set(file, parsed)
      hashesByFile.set(file, findRecordedHashes(parsed))
      fingerprintsByFile.set(file, findSourceFingerprint(parsed))
    } catch {
      unparsable.push(file)
      hashesByFile.set(file, [])
      fingerprintsByFile.set(file, undefined)
      evidenceByFile.set(file, undefined)
    }
  }

  const problems = []
  const manifestIssues = []
  let manifest
  if (!present.includes(MANIFEST_FILE)) {
    manifestIssues.push(MISSING_MANIFEST_MESSAGE)
  } else {
    try {
      manifest = JSON.parse(
        await dependencies.readFile(
          path.join(verificationRoot, MANIFEST_FILE),
          'utf8',
        ),
      )
    } catch {
      manifestIssues.push(
        `docs/verification/${MANIFEST_FILE} is not valid JSON, so nothing ties the ` +
          'evidence files to the CI run and the artifacts they describe. Fetch the ' +
          'manifest with scripts/fetch-verification-evidence.mjs instead of editing it.',
      )
    }
  }
  if (absent.length > 0) {
    problems.push(
      `evidence files are registered as current evidence but are missing: ` +
        `${absent.join(', ')}. Restore them, or drop them from EVIDENCE_PROFILE ` +
        'deliberately rather than letting the gate quietly check less.',
    )
  }
  if (unparsable.length > 0) {
    problems.push(`evidence files are not valid JSON: ${unparsable.join(', ')}`)
  }

  for (const [file] of entries) {
    problems.push(...validateEvidenceContract(file, evidenceByFile.get(file)))
  }

  const missing = entries
    .filter(([file]) => hashesByFile.get(file).length === 0)
    .map(([file]) => file)
  if (missing.length > 0) {
    problems.push(
      `evidence files record no binary sha256: ${missing.join(', ')}`,
    )
  }

  const conflicts = findProfileHashConflicts(
    groupEvidenceByProfile(entries),
    hashesByFile,
  )
  for (const conflict of conflicts) {
    problems.push(
      `${conflict.profile} evidence disagrees on the measured binary: ` +
        `${conflict.hashes.join(' vs ')} across ${conflict.files.join(', ')}. ` +
        'Re-run the affected scenarios on one binary instead of citing numbers measured on different builds.',
    )
  }

  // Internal consistency is not enough: the evidence must also be the evidence
  // of one specific CI run. That is what the manifest binds - fingerprint, both
  // artifact hashes and the run id - and it replaced a comparison against the
  // binary on disk, which could only ever hold for the single machine that ran
  // the capture (see the header comment).
  problems.push(...manifestIssues)
  if (manifest !== undefined) {
    problems.push(
      ...validateEvidenceManifest(manifest, {
        entries,
        evidenceByFile,
        sourceFingerprint,
      }),
    )
  }
  if (manifest !== undefined) {
    problems.push(
      ...(await validateRawLogArchive(
        manifest,
        dependencies.readdir ?? readdir,
      )),
    )
  }

  // A fingerprint recorded inside the evidence and the fingerprint recorded in
  // the manifest are two independent statements about the same checkout. The
  // manifest is checked above; this checks every per-file statement, so a file
  // that kept an older fingerprint cannot ride along on a fresh manifest. Both
  // profiles are covered: release evidence states it in provenance.fingerprint,
  // debug evidence in provenance.fingerprint and source.fingerprint.
  if (sourceFingerprint !== undefined) {
    for (const [file] of entries) {
      const evidence = evidenceByFile.get(file)
      const statements = []
      const sourceStatement = fingerprintsByFile.get(file)
      if (
        EVIDENCE_PROFILE.get(file) === 'debug' &&
        sourceStatement !== undefined
      ) {
        statements.push(['source.fingerprint', sourceStatement])
      }
      const provenanceStatement = readStringAt(evidence, [
        'provenance',
        'fingerprint',
      ])
      if (provenanceStatement !== undefined) {
        statements.push(['provenance.fingerprint', provenanceStatement])
      }
      const stale = statements.filter(
        statement => statement[1] !== sourceFingerprint,
      )
      if (stale.length === 0) continue
      problems.push(
        `${file} was recorded against source fingerprint ` +
          `${stale
            .map(([where, value]) => `${value} (${where})`)
            .join(' and ')}, but the terminal sources now fingerprint as ` +
          `${sourceFingerprint}. This file describes an older checkout. ` +
          'Re-run the scenario on the current sources instead of citing ' +
          'measurements taken before this change.',
      )
    }
  }

  return { checked: entries.length, problems }
}

// Compared on real paths: the runtime resolves the entry module through symlinks
// while argv[1] keeps the path as typed, so a checkout reached through a symlink
// would compare unequal and the gate would silently do nothing (exit 0, no output).
function realpathOrNull(target) {
  try {
    return realpathSync(target)
  } catch {
    return null
  }
}

const modulePath = realpathOrNull(fileURLToPath(import.meta.url))
const invokedPath =
  process.argv[1] === undefined
    ? null
    : realpathOrNull(path.resolve(process.argv[1]))

const isDirectRun = modulePath !== null && modulePath === invokedPath

if (isDirectRun) {
  const fingerprint = await computeSourceFingerprint()
  const { checked, problems } = await checkVerificationEvidence({
    sourceFingerprint: fingerprint,
  })
  if (problems.length > 0) {
    console.error(
      `Verification evidence gate failed: ${problems.length} problem(s).`,
    )
    for (const problem of problems) console.error(`- ${problem}`)
    process.exitCode = 1
  } else {
    console.log(
      `Verification evidence gate passed for ${checked} current evidence file(s).`,
    )
  }
}
