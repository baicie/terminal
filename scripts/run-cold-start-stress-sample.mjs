#!/usr/bin/env node
// One sample of the Phase 9.4 macOS cold-start stress run.
//
// The workflow loops this process instead of shell-parsing the stopwatch's
// human-readable output. A failed sample is still written as JSON so the
// summarizer can classify it rather than losing the only evidence it had.
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { runRemoteColdStartStopwatch } from './run-remote-cold-start-stopwatch.mjs'

const [sampleIndex, outputPath, appPath, timeoutArgument] = process.argv.slice(2)
const runCommand = promisify(execFile)

if (
  sampleIndex === undefined
  || outputPath === undefined
  || appPath === undefined
) {
  console.error(
    'usage: run-cold-start-stress-sample.mjs <index> <output.json> <app-path> [timeout-ms]',
  )
  process.exit(2)
}

const timeoutMs =
  timeoutArgument === undefined ? 10_000 : Number(timeoutArgument)
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
  console.error('timeout-ms must be a positive integer')
  process.exit(2)
}

const absoluteAppPath = path.resolve(appPath)
const capturedAt = new Date().toISOString()

async function gitValue(...args) {
  try {
    const { stdout } = await runCommand('git', args, {
      cwd: path.resolve(import.meta.dirname, '..'),
    })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Both the runner and any ad-hoc local run must be able to answer "which
 * commit and parent produced this binary". CI checks out depth=1, so HEAD^ can
 * be absent even though the revision is known; fall back to the workflow's
 * GITHUB_SHA parent query through git itself, then record the gap instead of
 * writing a parent that was never resolved.
 */
async function resolveParentCommit() {
  const direct = await gitValue('rev-parse', 'HEAD^')
  if (direct !== null) {
    return { sha: direct, source: 'git', reason: null }
  }
  const head = await gitValue('rev-parse', 'HEAD')
  const gitDir = await gitValue('rev-parse', '--absolute-git-dir')
  if (head !== null && gitDir !== null) {
    const shallow = await readFile(path.join(gitDir, 'shallow'), 'utf8').catch(
      () => '',
    )
    if (shallow.includes(head)) {
      return { sha: null, source: 'unknown', reason: 'shallow-checkout' }
    }
  }
  const parents = await gitValue('rev-list', '--parents', '-n', '1', 'HEAD')
  if (parents !== null) {
    const [resolvedHead, firstParent] = parents.trim().split(/\s+/)
    if (resolvedHead && firstParent) {
      return { sha: firstParent, source: 'git', reason: null }
    }
    if (resolvedHead) {
      return { sha: null, source: 'unknown', reason: 'root-commit' }
    }
  }
  return { sha: null, source: 'unknown', reason: 'command-failed' }
}

async function environmentFacts() {
  const [commit, parent, dirty] = await Promise.all([
    gitValue('rev-parse', 'HEAD'),
    resolveParentCommit(),
    gitValue('status', '--porcelain', '--untracked-files=no'),
  ])
  const parentCommit = parent.sha
  let cpuCount = null
  try {
    const { stdout } = await runCommand('/usr/sbin/sysctl', ['-n', 'hw.ncpu'])
    cpuCount = Number(stdout.trim()) || null
  } catch {}
  let memoryBytes = null
  try {
    const { stdout } = await runCommand('/usr/sbin/sysctl', [
      '-n',
      'hw.memsize',
    ])
    memoryBytes = Number(stdout.trim()) || null
  } catch {}
  let osVersion = null
  try {
    const { stdout } = await runCommand('/usr/bin/sw_vers', ['-productVersion'])
    osVersion = stdout.trim()
  } catch {}
  return {
    commit,
    parentCommit,
    parentCommitSource: parent.source,
    parentCommitReason: parent.reason,
    workingTreeClean: dirty === '',
    cpuCount,
    memoryBytes,
    osVersion,
    platform: process.platform,
    arch: process.arch,
  }
}

try {
  const result = await runRemoteColdStartStopwatch({
    appPath: absoluteAppPath,
    timeoutMs,
  })
  const environment = await environmentFacts()
  await writeFile(
    outputPath,
    JSON.stringify({
      ...result,
      sampleIndex: Number(sampleIndex),
      capturedAt,
      sourceSha: environment.commit,
      sourceParentSha: environment.parentCommit,
      sourceParentShaSource: environment.parentCommitSource,
      sourceParentShaReason: environment.parentCommitReason,
      sourceTreeClean: environment.workingTreeClean,
      timeoutMs,
      environment,
    }),
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const environment = await environmentFacts()
  await writeFile(
    outputPath,
    JSON.stringify({
      ok: false,
      sampleIndex: Number(sampleIndex),
      capturedAt,
      appPath: absoluteAppPath,
      timeoutMs,
      ...(Array.isArray(error.stages) ? { stages: error.stages } : {}),
      ...(error.probe === undefined ? {} : { probe: error.probe }),
      // The failure path must carry the same build identity as the success
      // path. A missing value is recorded as unknown with a reason, never
      // guessed (Issue #185).
      ...(typeof error.binarySha256 === 'string'
        ? { binarySha256: error.binarySha256 }
        : { binarySha256: null, binarySha256Reason: 'unavailable' }),
      ...(error.fixture === undefined ? {} : { fixture: error.fixture }),
      ...(error.shell === undefined ? {} : { shell: error.shell }),
      ...(error.shellIntegration === undefined
        ? {}
        : { shellIntegration: error.shellIntegration }),
      ...(error.marker === undefined ? {} : { marker: error.marker }),
      ...(error.promptMarker === undefined
        ? {}
        : { promptMarker: error.promptMarker }),
      ...(error.cleanupError === undefined
        ? {}
        : { cleanupError: error.cleanupError }),
      ...(error.cleanupErrors === undefined
        ? {}
        : { cleanupErrors: error.cleanupErrors }),
      ...(error.tempDirectories === undefined
        ? {}
        : { tempDirectories: error.tempDirectories }),
      sourceSha: environment.commit,
      sourceParentSha: environment.parentCommit,
      sourceParentShaSource: environment.parentCommitSource,
      sourceParentShaReason: environment.parentCommitReason,
      sourceTreeClean: environment.workingTreeClean,
      environment,
      error: message,
    }),
  )
  process.exitCode = 1
}
