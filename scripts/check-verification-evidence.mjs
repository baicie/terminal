import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Guards the recorded acceptance evidence against a failure mode that is
 * invisible when reading a single evidence file: every smoke runner relinks
 * target/debug or target/release, so two current evidence files can end up
 * describing different binaries while both read as authoritative.
 *
 * Historical records are deliberately exempt from a disk check. They document
 * the binary that existed at the time, which is the reason they are kept, so
 * requiring them to match what is on disk today would be wrong.
 */

const projectRoot = path.resolve(import.meta.dirname, '..')
const verificationRoot = path.join(projectRoot, 'docs', 'verification')

const EVIDENCE_PROFILE = new Map([
  ['2026-10-11-macos-cold-start-current.json', 'debug'],
  ['2026-10-11-macos-remote-shell-prompt-rerun.json', 'debug'],
  ['2026-10-11-macos-ssh-matrix-current.json', 'debug'],
  ['2026-10-11-macos-shell-interaction-current.json', 'debug'],
  ['2026-10-11-macos-release-terminal-gate.json', 'release'],
  ['2026-10-11-macos-release-ssh-matrix.json', 'release'],
])

// Only the release profile is pinned to a binary on disk. `pnpm verify` runs
// cargo, which relinks target/debug/terminal as a bare cargo build whose
// frontend is not embedded, so a debug artifact on disk can never be expected
// to match evidence taken from a `tauri build --debug` run inside this same
// gate. Debug evidence is therefore pinned to a reviewed hash instead.
const PROFILE_BINARY = new Map([
  ['release', 'src-tauri/target/release/terminal'],
])

const PROFILE_REVIEWED_HASH = new Map([
  // Reviewed on 2026-10-17. This build includes the startup fallback ownership
  // fix, the direct command-write input handoff, Linux remote fixture
  // isolation, shell probe dialect fail-fast, and transient authentication
  // retry classification. The 13-case SSH matrix, local/real-SSH shell
  // probes, local cold-start and remote prompt marker were re-run on this same
  // instrumented debug binary before the hash moved here.
  //
  // The earlier build included the serial port platform
  // classification fix and waits for the first SSH shell output
  // before injecting startup commands, and accepts a remote prompt marker
  // adjacent to an OSC sequence in the same output chunk. It also gives the
  // OSC 133 exit code a real
  // consumer: `command-finished` reached the frontend and was written into
  // `ShellIntegrationState.lastExitCode`, but `snapshot()` had no caller in
  // production, so a failed command was invisible until the user scrolled back
  // through the scrollback. The pane header now renders that status. The build
  // also drops the bash `trap ... DEBUG` line from the shell-integration
  // injection, because bash has no additive trap and the line silently
  // replaced whatever DEBUG trap the user's own rc had already installed. See
  // docs/issue.md Issue #96 and #97. Against this build the 13-case SSH matrix,
  // the shell interaction matrix (bash and zsh, seven cases each), the same
  // seven cases over real SSH, a local cold-start run and the remote SSH
  // prompt cold start were all re-run green before the hash moved here. The
  // matrix also includes a real first-connect outage: sshd stays down before
  // the app starts and the app must connect after it returns, proving Issue
  // #98 over the actual SSH transport rather than only injected dependencies.
  // The current-source rerun also covers the 13-case SSH matrix, the local
  // cold-start stopwatch, the remote prompt stopwatch, and local/real-SSH
  // shell probes. Vim probes now wait for the editor to finish before sending
  // the shell-side verification command, and the terminal smoke frame helper
  // is split into its own source file to keep the source-size gate satisfied.
  [
    'debug',
    'cd22a67c98742c94f40fb51466a172ed8bce556e72f75d433de326fbf89e7df0',
  ],
])

// Exported so the gate's own tests assert against the hash the gate actually
// enforces. A test that carried its own copy of the hash would keep passing
// after a deliberate review update, and would start failing when the reviewed
// build legitimately moves.
export function reviewedHashForProfile(profile) {
  return PROFILE_REVIEWED_HASH.get(profile)
}

async function hashFile(filePath, dependencies) {
  const contents = await dependencies.readFile(filePath)
  return createHash('sha256').update(contents).digest('hex')
}

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

// Sources the acceptance scenarios actually exercise. Docs, evidence records
// and unrelated tooling are excluded on purpose: a fingerprint that moved for
// a typo in a markdown file would train people to ignore this gate instead of
// re-running the measurements.
const FINGERPRINT_ROOTS = [
  'packages/frontend/src',
  'src-tauri/src',
  'packages/frontend/package.json',
  'package.json',
  'pnpm-lock.yaml',
]

const FINGERPRINT_IGNORED = new Set([
  'node_modules',
  'dist',
  'target',
  '.git',
])

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
 * Fingerprints the sources the macOS acceptance evidence describes.
 *
 * Debug evidence cannot be validated against its artifact because `pnpm
 * verify` relinks target/debug as a bare cargo build, so the only way to notice
 * that a measurement predates a code change is to fingerprint the code
 * itself. Content hashing keeps this independent of mtimes, checkouts and
 * line endings.
 */
export async function computeSourceFingerprint(dependencies = { readdir, readFile, stat }) {
  const files = []
  for (const root of FINGERPRINT_ROOTS) {
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
  const unparsable = []

  for (const [file] of entries) {
    const raw = await dependencies.readFile(
      path.join(verificationRoot, file),
      'utf8',
    )
    try {
      const parsed = JSON.parse(raw)
      hashesByFile.set(file, findRecordedHashes(parsed))
      fingerprintsByFile.set(file, findSourceFingerprint(parsed))
    } catch {
      unparsable.push(file)
      hashesByFile.set(file, [])
      fingerprintsByFile.set(file, undefined)
    }
  }

  const problems = []
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

  const missing = entries
    .filter(([file]) => hashesByFile.get(file).length === 0)
    .map(([file]) => file)
  if (missing.length > 0) {
    problems.push(`evidence files record no binary sha256: ${missing.join(', ')}`)
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

  // Internal consistency is not enough: every profile's evidence must also
  // describe the binary that is actually on disk. Without this, a stale
  // "current" file keeps passing after the working tree has moved on, which is
  // exactly how outdated debug evidence survived several rounds unnoticed.
  for (const [profile, binaryPath] of PROFILE_BINARY) {
    const files = entries.filter(([file]) => EVIDENCE_PROFILE.get(file) === profile)
    if (files.length === 0) continue
    let onDisk
    try {
      onDisk = await hashFile(path.join(projectRoot, binaryPath), dependencies)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      problems.push(
        `${profile} evidence cannot be checked against ${binaryPath}: the binary is not built. ` +
          'Build it before citing cold-start or matrix numbers for this profile.',
      )
      continue
    }
    for (const [file] of files) {
      const hashes = hashesByFile.get(file) ?? []
      if (hashes.length > 0 && !hashes.includes(onDisk)) {
        problems.push(
          `${profile} evidence ${file} does not describe the binary on disk ` +
            `(${onDisk}): it records ${hashes.join(', ')}. ` +
            'Re-run the scenario, or stop presenting the file as current evidence.',
        )
      }
    }
  }

  for (const [profile, reviewed] of PROFILE_REVIEWED_HASH) {
    const files = entries.filter(([file]) => EVIDENCE_PROFILE.get(file) === profile)
    if (files.length === 0) continue
    for (const [file] of files) {
      const hashes = hashesByFile.get(file) ?? []
      if (hashes.length > 0 && !hashes.includes(reviewed)) {
        problems.push(
          `${profile} evidence ${file} does not describe the reviewed binary ` +
            `(${reviewed}): it records ${hashes.join(', ')}. ` +
            'Re-run the scenario on that build, or update the reviewed hash deliberately.',
        )
      }
    }
  }

  // Debug evidence cannot be compared against the artifact on disk (see
  // PROFILE_REVIEWED_HASH), which left a blind spot: editing the terminal
  // frontend after the evidence was recorded changed no evidence field and no
  // reviewed hash, so the stale numbers kept reading as current. Comparing a
  // fingerprint of the sources those scenarios exercise closes that gap
  // without pretending the debug binary is reproducible.
  if (sourceFingerprint !== undefined) {
    for (const [file] of entries) {
      if (EVIDENCE_PROFILE.get(file) !== 'debug') continue
      const recorded = fingerprintsByFile.get(file)
      if (recorded === undefined || recorded === null) continue
      if (recorded !== sourceFingerprint) {
        problems.push(
          `debug evidence ${file} was recorded against source fingerprint ` +
            `${recorded}, but the terminal sources now fingerprint as ` +
            `${sourceFingerprint}. Re-run the scenario on the current sources ` +
            'instead of citing measurements taken before this change.',
        )
      }
    }
  }

  return { checked: entries.length, problems }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

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
