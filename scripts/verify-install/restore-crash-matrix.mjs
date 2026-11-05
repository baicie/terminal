#!/usr/bin/env node
/**
 * Real crash-point matrix for the staged restore.
 *
 * Each of the eight RESTORE_STAGES runs in its own worker process. The worker
 * SIGKILLs itself immediately after the stage completes; the parent proves:
 *
 *   - the worker pid that wrote the stage marker is the pid it spawned;
 *   - the process really exited from SIGKILL (exit code null);
 *   - the on-disk file set after the crash matches the stage's expected state
 *     (main DB still live or already the backup, staging file present only
 *     between STAGE and COMMIT, never a partial publish);
 *   - a separate retry process converges, and the final DB passes
 *     integrity_check with the backup's content.
 *
 * Usage: node restore-crash-matrix.mjs [--report <path>] [--keep]
 * Exit codes: 0 all stages passed, 1 a stage failed.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync,
  readSync, rmSync, writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertStageOrder, RESTORE_STAGES } from './recovery-state-machine.mjs'
import { launchProcess, raceAfter } from './process-lifecycle.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKER = path.join(HERE, 'restore-worker.mjs')
const TEMP_NAME = 'terminal.restore.tmp'

export function sha256File(file) {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(1 << 20)
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read === 0) break
      hash.update(buffer.subarray(0, read))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

export function sqliteNodeFlags() {
  try {
    execFileSync(process.execPath, ['-e', 'require("node:sqlite")'], { stdio: 'ignore' })
    return []
  } catch {
    execFileSync(process.execPath, ['--experimental-sqlite', '-e', 'require("node:sqlite")'], { stdio: 'ignore' })
    return ['--experimental-sqlite']
  }
}

function runWorkerSync(flags, label, args) {
  const result = spawnSync(process.execPath, [...flags, WORKER, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status}): ${result.stderr || result.stdout}`)
  }
  const line = result.stdout.trim().split('\n').filter(Boolean).pop()
  return JSON.parse(line)
}

function snapshotDir(directory) {
  const snapshot = {}
  for (const name of readdirSync(directory).sort()) {
    snapshot[name] = sha256File(path.join(directory, name))
  }
  return snapshot
}

function readStageLog(file) {
  const text = readFileSync(file, 'utf8').trim()
  if (!text) return []
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function assertEqual(problems, label, actual, expected) {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    problems.push(`${label}: actual ${actualText} != expected ${expectedText}`)
  }
}

function expectedPreRetrySnapshot(stage, liveSha, backupSha) {
  const index = RESTORE_STAGES.indexOf(stage)
  if (index < 0) throw new Error('unknown stage: ' + stage)
  const expected = {}
  // The publish is the rename at VERIFY. Only then does the main DB hold the
  // backup; before that it must still be the untouched live DB.
  expected['terminal.db'] = index >= RESTORE_STAGES.indexOf('VERIFY') ? backupSha : liveSha
  if (index >= RESTORE_STAGES.indexOf('STAGE') && index <= RESTORE_STAGES.indexOf('COMMIT')) {
    expected[TEMP_NAME] = backupSha
  }
  return expected
}

async function crashStage({ root, stage, flags, expectValue }) {
  const caseDir = path.join(root, stage)
  const dataDir = path.join(caseDir, 'data')
  const stageLog = path.join(caseDir, 'stages.jsonl')
  const workerLog = path.join(caseDir, 'worker.log')
  mkdirSync(dataDir, { recursive: true })

  const liveFixture = path.join(caseDir, 'live.db')
  const backupFixture = path.join(caseDir, 'backup.db')
  runWorkerSync(flags, 'create live fixture', ['create', '--db', liveFixture, '--value', 'live'])
  runWorkerSync(flags, 'create backup fixture', ['create', '--db', backupFixture, '--value', 'backup'])
  const liveSha = sha256File(liveFixture)
  const backupSha = sha256File(backupFixture)
  cpSync(liveFixture, path.join(dataDir, 'terminal.db'))
  if (sha256File(path.join(dataDir, 'terminal.db')) !== liveSha) {
    throw new Error('fixture copy does not match the live fixture')
  }

  const child = launchProcess(process.execPath, [...flags, WORKER, 'restore',
    '--db', path.join(dataDir, 'terminal.db'),
    '--backup', backupFixture,
    '--data-dir', dataDir,
    '--stage-log', stageLog,
    '--crash-at', stage,
    '--expect-value', expectValue,
  ], { logPath: workerLog })

  const exited = await raceAfter(child.lifecycle.exitPromise.then(() => true), 15_000)
  const problems = []
  if (exited !== true) problems.push('worker did not exit within 15s')
  const closed = await raceAfter(child.lifecycle.closePromise.then(() => true), 5_000)
  if (closed !== true) problems.push('worker stdio did not close')

  const entries = readStageLog(stageLog)
  assertStageOrder(entries.map(entry => entry.stage))
  const last = entries[entries.length - 1]
  assertEqual(problems, 'last stage', last?.stage ?? null, stage)
  const foreignPids = [...new Set(entries.map(entry => entry.pid).filter(pid => pid !== child.pid))]
  if (entries.length > 0 && entries[0].pid !== child.pid) {
    problems.push(`stage log pid ${entries[0].pid} != spawned pid ${child.pid}`)
  }
  if (foreignPids.length > 0) problems.push('stage log contains foreign pids: ' + foreignPids.join(','))

  if (process.platform === 'win32') {
    // Windows has no POSIX signals; Node terminates the process and reports a
    // non-zero exit code instead. Record what was observed without pretending
    // it was SIGKILL.
    if (child.lifecycle.exitCode === null || child.lifecycle.exitCode === 0) {
      problems.push('worker did not terminate with a non-zero exit code')
    }
  } else {
    assertEqual(problems, 'exit signal', child.lifecycle.signal, 'SIGKILL')
    assertEqual(problems, 'exit code', child.lifecycle.exitCode, null)
  }
  if (child.lifecycle.exitObserved !== true) problems.push('exit not observed')
  if (child.lifecycle.closeObserved !== true) problems.push('close not observed')

  const crashedSnapshot = snapshotDir(dataDir)
  const expectedSnapshot = expectedPreRetrySnapshot(stage, liveSha, backupSha)
  assertEqual(problems, 'post-crash file set', crashedSnapshot, expectedSnapshot)

  const retried = runWorkerSync(flags, 'retry', ['retry',
    '--db', path.join(dataDir, 'terminal.db'),
    '--backup', backupFixture,
    '--data-dir', dataDir,
    '--stage-log', stageLog,
    '--expect-value', expectValue,
  ])
  const expectedOutcome = RESTORE_STAGES.indexOf(stage) >= RESTORE_STAGES.indexOf('VERIFY')
    ? 'already-restored'
    : 'restored'
  assertEqual(problems, 'retry outcome', retried.outcome, expectedOutcome)
  if (expectedOutcome === 'restored') {
    assertEqual(problems, 'retry stages', retried.stages, RESTORE_STAGES)
  }

  const finalSnapshot = snapshotDir(dataDir)
  assertEqual(problems, 'final file set', finalSnapshot, { 'terminal.db': backupSha })
  const inspected = runWorkerSync(flags, 'inspect', ['inspect',
    '--db', path.join(dataDir, 'terminal.db'), '--expect-value', expectValue])
  assertEqual(problems, 'restored DB integrity', inspected.integrity, 'ok')
  assertEqual(problems, 'restored DB content', inspected.value, expectValue)

  return {
    stage,
    pid: child.pid,
    exit: {
      signal: child.lifecycle.signal,
      code: child.lifecycle.exitCode,
      exitObserved: child.lifecycle.exitObserved,
      closeObserved: child.lifecycle.closeObserved,
    },
    stagesObserved: entries.map(entry => entry.stage),
    liveSha256: liveSha,
    backupSha256: backupSha,
    postCrash: crashedSnapshot,
    retry: { outcome: retried.outcome, stages: retried.stages ?? [] },
    final: finalSnapshot,
    integrity: inspected.integrity,
    value: expectValue,
    pass: problems.length === 0,
    problems,
  }
}

async function controlRun({ root, flags, expectValue }) {
  const caseDir = path.join(root, 'CONTROL')
  const dataDir = path.join(caseDir, 'data')
  const stageLog = path.join(caseDir, 'stages.jsonl')
  mkdirSync(dataDir, { recursive: true })
  const liveFixture = path.join(caseDir, 'live.db')
  const backupFixture = path.join(caseDir, 'backup.db')
  runWorkerSync(flags, 'create live fixture', ['create', '--db', liveFixture, '--value', 'live'])
  runWorkerSync(flags, 'create backup fixture', ['create', '--db', backupFixture, '--value', 'backup'])
  const backupSha = sha256File(backupFixture)
  cpSync(liveFixture, path.join(dataDir, 'terminal.db'))
  const result = runWorkerSync(flags, 'control restore', ['restore',
    '--db', path.join(dataDir, 'terminal.db'),
    '--backup', backupFixture,
    '--data-dir', dataDir,
    '--stage-log', stageLog,
    '--expect-value', expectValue,
  ])
  const problems = []
  assertEqual(problems, 'control stages', result.stages, RESTORE_STAGES)
  assertEqual(problems, 'control file set', snapshotDir(dataDir), { 'terminal.db': backupSha })
  const inspected = runWorkerSync(flags, 'inspect', ['inspect',
    '--db', path.join(dataDir, 'terminal.db'), '--expect-value', expectValue])
  assertEqual(problems, 'control integrity', inspected.integrity, 'ok')
  assertEqual(problems, 'control content', inspected.value, expectValue)
  return { outcome: result.outcome, stages: result.stages, pass: problems.length === 0, problems }
}

export async function runCrashMatrix({ keep = false, expectValue = 'backup' } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'restore-crash-matrix-'))
  const flags = sqliteNodeFlags()
  try {
    const stages = []
    for (const stage of RESTORE_STAGES) {
      stages.push(await crashStage({ root, stage, flags, expectValue }))
    }
    const control = await controlRun({ root, flags, expectValue })
    const failed = stages.filter(entry => !entry.pass)
    return {
      root: keep ? root : null,
      passed: failed.length === 0 && control.pass,
      stages,
      control,
      problems: failed.flatMap(entry => entry.problems.map(problem => `${entry.stage}: ${problem}`)),
    }
  } finally {
    if (!keep) rmSync(root, { recursive: true, force: true })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const reportIndex = args.indexOf('--report')
  const keep = args.includes('--keep')
  const result = await runCrashMatrix({ keep })
  for (const entry of result.stages) {
    process.stdout.write(
      `${entry.pass ? 'PASS' : 'FAIL'} ${entry.stage.padEnd(13)} ` +
      `pid=${entry.pid} signal=${entry.exit.signal} code=${entry.exit.code} ` +
      `retry=${entry.retry.outcome} files=${Object.keys(entry.final).join(',')}` +
      (entry.problems.length ? ' :: ' + entry.problems.join('; ') : '') + '\n',
    )
  }
  process.stdout.write(`${result.control.pass ? 'PASS' : 'FAIL'} CONTROL       full staged restore\n`)
  if (reportIndex >= 0 && args[reportIndex + 1]) {
    writeFileSync(args[reportIndex + 1], JSON.stringify(result, null, 2) + '\n')
  }
  if (!result.passed) {
    process.stderr.write(result.problems.join('\n') + '\n')
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('[restore-crash-matrix] ' + (error?.stack || error) + '\n')
    process.exit(1)
  })
}
