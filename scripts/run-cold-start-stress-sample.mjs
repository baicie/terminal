#!/usr/bin/env node
// One sample of the Phase 9.4 macOS cold-start stress run.
//
// The workflow loops this process instead of shell-parsing the stopwatch's
// human-readable output. A failed sample is still written as JSON so the
// summarizer can classify it rather than losing the only evidence it had.
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
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
      cwd: path.dirname(new URL(import.meta.url).pathname),
    })
    return stdout.trim()
  } catch {
    return null
  }
}

async function environmentFacts() {
  const [commit, parentCommit, dirty] = await Promise.all([
    gitValue('rev-parse', 'HEAD'),
    gitValue('rev-parse', 'HEAD^'),
    gitValue('status', '--porcelain', '--untracked-files=no'),
  ])
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
      sourceSha: environment.commit,
      sourceParentSha: environment.parentCommit,
      sourceTreeClean: environment.workingTreeClean,
      environment,
      error: message,
    }),
  )
  process.exitCode = 1
}
