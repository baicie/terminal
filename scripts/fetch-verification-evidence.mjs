#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  checkVerificationEvidence,
  computeSourceFingerprint,
  EVIDENCE_MANIFEST_FILE,
} from './check-verification-evidence.mjs'

/**
 * Downloads the evidence bundle of one real-machine-matrix run and installs it
 * into the working tree, so a developer machine only has to fetch and verify.
 *
 *   node scripts/fetch-verification-evidence.mjs --latest
 *   node scripts/fetch-verification-evidence.mjs --run-id 5000000001 --with-binaries
 *   node scripts/fetch-verification-evidence.mjs --from /tmp/verification-evidence
 *
 * --from installs an already-extracted bundle, which is how this script is
 * exercised without a GitHub run.
 *
 * The bundle is the artifact the macOS job uploads under the name
 * verification-evidence:
 *
 *   docs/verification/<six evidence files> + evidence-manifest.json
 *   evidence-logs/<seven raw logs>
 *   binaries/debug/terminal, binaries/release/terminal
 *
 * The six files and the manifest are copied into docs/verification, the raw
 * logs into docs/verification/raw/<runId>/ (they are the audit trail for every
 * number in those files), and the two binaries into src-tauri/target when
 * --with-binaries is given. The gate runs last, on the files as they now sit
 * on disk.
 */

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')
const VERIFICATION_ROOT = path.join(PROJECT_ROOT, 'docs', 'verification')
const RAW_ROOT = path.join(VERIFICATION_ROOT, 'raw')
const ARTIFACT_NAME = 'verification-evidence'
const WORKFLOW_FILE = 'real-machine-matrix.yml'

const EVIDENCE_FILES = [
  '2026-10-11-macos-cold-start-current.json',
  '2026-10-11-macos-remote-shell-prompt-rerun.json',
  '2026-10-11-macos-ssh-matrix-current.json',
  '2026-10-11-macos-shell-interaction-current.json',
  '2026-10-11-macos-release-terminal-gate.json',
  '2026-10-11-macos-release-ssh-matrix.json',
]

const BINARIES = [
  ['binaries/debug/terminal', 'src-tauri/target/debug/terminal'],
  ['binaries/release/terminal', 'src-tauri/target/release/terminal'],
]

const run = promisify(execFile)

async function gh(args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await run('gh', args, {
      cwd: PROJECT_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    })
    return { ok: true, stdout }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'gh is not installed. Install the GitHub CLI (https://cli.github.com) and run ' +
          '`gh auth login` before fetching evidence.',
      )
    }
    if (allowFailure) return { ok: false, stdout: '', error }
    throw new Error(
      'gh ' + args.join(' ') + ' failed: ' + (error.stderr || error.message).trim(),
    )
  }
}

function parseArguments(argv) {
  const value = name => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  return {
    runId: value('--run-id'),
    latest: argv.includes('--latest') || value('--run-id') === undefined,
    withBinaries: argv.includes('--with-binaries'),
    directory: value('--dir'),
    from: value('--from'),
  }
}

async function resolveRunId(options) {
  if (!options.latest && options.runId !== undefined) return options.runId
  const { stdout } = await gh([
    'run',
    'list',
    '--workflow',
    WORKFLOW_FILE,
    '--status',
    'success',
    '--limit',
    '1',
    '--json',
    'databaseId,headSha,createdAt',
    '--jq',
    '.[0] | "\(.databaseId) \(.headSha) \(.createdAt)"',
  ])
  const [databaseId, headSha, createdAt] = stdout.trim().split(' ')
  if (!databaseId) {
    throw new Error(
      'no successful ' + WORKFLOW_FILE + ' run found. Dispatch the workflow first, or ' +
        'pass --run-id <id> for a specific run.',
    )
  }
  console.log(
    'Using the newest successful run ' +
      databaseId +
      ' (' +
      String(headSha).slice(0, 7) +
      ', ' +
      createdAt +
      ').',
  )
  return databaseId
}

async function manifestRunId(bundleDirectory) {
  const manifestPath = path.join(bundleDirectory, 'docs', 'verification', EVIDENCE_MANIFEST_FILE)
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    throw new Error(
      'no run id was given and ' + manifestPath + ' is not readable, so the raw logs ' +
        'have no directory to go into. Pass --run-id <id>.',
    )
  }
  if (typeof manifest.runId !== 'string' || manifest.runId === '') {
    throw new Error(manifestPath + ' records no runId; pass --run-id <id> instead.')
  }
  return manifest.runId
}

async function bundleFileExists(bundleDirectory, relativePath) {
  try {
    const stats = await stat(path.join(bundleDirectory, relativePath))
    return stats.isFile()
  } catch {
    return false
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  let bundleDirectory
  let runId = options.runId

  if (options.from !== undefined) {
    // Only a bundle extracted by hand lands here. The run id it was produced by
    // still comes from its manifest, so nothing is taken on trust.
    bundleDirectory = path.resolve(options.from)
    console.log('Installing the already-extracted bundle at ' + bundleDirectory + '.')
  } else {
    runId = await resolveRunId(options)
    // The directory this script owns is named after the run: removing anything
    // wider than that would put a user-supplied --dir at risk.
    bundleDirectory = path.resolve(
      path.join(
        options.directory ?? os.tmpdir(),
        'terminal-verification-evidence-' + runId,
      ),
    )
    await rm(bundleDirectory, { recursive: true, force: true })
    await mkdir(bundleDirectory, { recursive: true })
    console.log('Downloading artifact ' + ARTIFACT_NAME + ' of run ' + runId + '...')
    await gh(['run', 'download', runId, '--name', ARTIFACT_NAME, '--dir', bundleDirectory])
  }

  if (runId === undefined) {
    runId = await manifestRunId(bundleDirectory)
  }

  const missing = []
  for (const file of [...EVIDENCE_FILES, EVIDENCE_MANIFEST_FILE]) {
    if (!(await bundleFileExists(bundleDirectory, path.join('docs', 'verification', file)))) {
      missing.push('docs/verification/' + file)
    }
  }
  let logs = []
  try {
    logs = (await readdir(path.join(bundleDirectory, 'evidence-logs'))).filter(name =>
      name.endsWith('.log'),
    )
  } catch {
    logs = []
  }
  if (logs.length === 0) missing.push('evidence-logs/*.log')
  if (missing.length > 0) {
    throw new Error(
      'the downloaded bundle is incomplete: missing ' +
        missing.join(', ') +
        '. A run only produces these when every scenario was measured and green; ' +
        'check the job log of run ' +
        runId +
        ' before fetching again. The partial download is kept at ' +
        bundleDirectory,
    )
  }

  for (const file of [...EVIDENCE_FILES, EVIDENCE_MANIFEST_FILE]) {
    await copyFile(
      path.join(bundleDirectory, 'docs', 'verification', file),
      path.join(VERIFICATION_ROOT, file),
    )
  }
  const rawDirectory = path.join(RAW_ROOT, runId)
  await mkdir(rawDirectory, { recursive: true })
  for (const log of logs) {
    await copyFile(path.join(bundleDirectory, 'evidence-logs', log), path.join(rawDirectory, log))
  }

  console.log(
    'Installed ' +
      EVIDENCE_FILES.length +
      ' evidence file(s) and ' +
      EVIDENCE_MANIFEST_FILE +
      ' into docs/verification.',
  )
  console.log(
    'Installed ' + logs.length + ' raw log(s) into docs/verification/raw/' + runId + '/.',
  )

  if (options.withBinaries) {
    const installed = []
    for (const [relative, target] of BINARIES) {
      if (!(await bundleFileExists(bundleDirectory, relative))) {
        console.log('Skipping ' + target + ': the bundle does not contain ' + relative + '.')
        continue
      }
      await mkdir(path.dirname(path.join(PROJECT_ROOT, target)), { recursive: true })
      await copyFile(path.join(bundleDirectory, relative), path.join(PROJECT_ROOT, target))
      await chmod(path.join(PROJECT_ROOT, target), 0o755)
      installed.push(target)
    }
    for (const target of installed) console.log('Installed binary ' + target + '.')
  } else {
    console.log(
      'The two artifacts were not installed; pass --with-binaries to put them at ' +
        'src-tauri/target/{debug,release}/terminal.',
    )
  }

  // The audit trail is only worth keeping if it can be committed: the repo
  // ignores *.log, so say so instead of leaving an untracked directory behind.
  const ignored = await gh(['check-ignore', path.join(rawDirectory, logs[0])], {
    allowFailure: true,
  })
  if (ignored.ok) {
    console.log(
      'Note: .gitignore currently ignores *.log, so docs/verification/raw/ cannot be ' +
        'committed as it stands. Add the negation "!docs/verification/raw/**" before ' +
        'staging the audit trail.',
    )
  }

  const sourceFingerprint = await computeSourceFingerprint()
  const { checked, problems } = await checkVerificationEvidence({ sourceFingerprint })
  if (problems.length > 0) {
    console.error('Verification evidence gate failed: ' + problems.length + ' problem(s).')
    for (const problem of problems) console.error('- ' + problem)
    process.exitCode = 1
    return
  }

  console.log('Verification evidence gate passed for ' + checked + ' current evidence file(s).')
  console.log(
    'Next: review the diff under docs/verification and commit it with the sources it describes.',
  )
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
