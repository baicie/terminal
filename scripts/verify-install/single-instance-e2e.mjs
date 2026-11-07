#!/usr/bin/env node
/**
 * Real two-process single-instance check.
 *
 * Launches the real application binary three times against one throwaway HOME:
 *   1. first launch owns the instance lock and stays alive;
 *   2. second launch is refused by the single-instance plugin and must activate
 *      the first process instead of opening a second database path;
 *   3. after the owner is killed, a third launch must succeed (the OS released
 *      the lock), proving crash recovery of the instance lock.
 *
 * Usage:
 *   node single-instance-e2e.mjs --binary <app-binary> --work-dir <dir> \
 *     [--report <report.json>] [--identifier com.baicie.termius]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const IDENTIFIER = 'com.baicie.termius'

function parseArgs(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) flags[token.slice(2)] = true
    else {
      flags[token.slice(2)] = next
      index += 1
    }
  }
  return flags
}

function appDataDir(home) {
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', IDENTIFIER)
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', IDENTIFIER)
  }
  return path.join(home, '.config', IDENTIFIER)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch {
      // retry
    }
    await delay(100)
  }
  throw new Error('timed out waiting for ' + label)
}

function launch(binary, home, logPath, extraEnv = {}) {
  const out = spawn(binary, [], {
    cwd: os.tmpdir(),
    env: { ...process.env, HOME: home, SSH_AUTH_SOCK: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chunks = []
  out.stdout.on('data', chunk => chunks.push(chunk))
  out.stderr.on('data', chunk => chunks.push(chunk))
  const exited = new Promise(resolve => {
    out.on('exit', (code, signal) => {
      try {
        writeFileSync(logPath, Buffer.concat(chunks))
      } catch {
        // best effort
      }
      resolve({ code, signal })
    })
  })
  return { child: out, exited }
}

async function stop(child, exited) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 8_000)
    const result = await exited
    clearTimeout(timer)
    return result
  }
  return exited
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (typeof flags.binary !== 'string') {
    throw new Error('usage: single-instance-e2e.mjs --binary <app-binary> --work-dir <dir>')
  }
  const binary = path.resolve(flags.binary)
  const workRoot = path.resolve(flags['work-dir'] || os.tmpdir())
  mkdirSync(workRoot, { recursive: true })
  const work = mkdtempSync(path.join(workRoot, 'single-instance-'))
  const home = path.join(work, 'home')
  const logs = path.join(work, 'logs')
  mkdirSync(home, { recursive: true })
  mkdirSync(logs, { recursive: true })
  const dataDir = appDataDir(home)
  const db = path.join(dataDir, 'terminal.db')
  const activation = path.join(work, 'activation.log')
  const env = { TERMINAL_SINGLE_INSTANCE_ACTIVATION_PATH: activation }
  const report = {
    platform: process.platform,
    binary,
    work,
    checks: {},
    status: 'FAIL',
  }
  const add = (name, ok, detail) => {
    report.checks[name] = { status: ok ? 'PASS' : 'FAIL', detail: detail || '' }
  }

  let first = null
  let second = null
  let third = null
  try {
    first = launch(binary, home, path.join(logs, 'first.log'), env)
    await waitFor(() => existsSync(db), 120_000, 'the first instance database')
    await delay(3_000)
    add('first started', first.child.exitCode === null, 'pid=' + first.child.pid)

    second = launch(binary, home, path.join(logs, 'second.log'), env)
    const secondExit = await Promise.race([
      second.exited,
      delay(30_000).then(() => null),
    ])
    add('second exited instead of starting a second instance', Boolean(secondExit),
      secondExit ? JSON.stringify(secondExit) : 'still running after 30s')
    const activated = await waitFor(() => (existsSync(activation) ? readFileSync(activation, 'utf8') : null),
      15_000, 'activation by the first instance').catch(() => null)
    add('second launch activated the first instance', Boolean(activated), activated || 'no activation record')
    add('first instance still running', first.child.exitCode === null,
      'pid=' + first.child.pid)

    const firstStop = await stop(first.child, first.exited)
    first = null
    add('first instance stopped', true, JSON.stringify(firstStop))
    await delay(2_000)

    third = launch(binary, home, path.join(logs, 'third.log'), env)
    await waitFor(() => existsSync(db), 60_000, 'the third instance database')
    await delay(5_000)
    add('a new instance starts after the owner died', third.child.exitCode === null,
      'pid=' + third.child.pid)
    const thirdStop = await stop(third.child, third.exited)
    third = null
    add('third instance stopped', true, JSON.stringify(thirdStop))
  } finally {
    if (first) await stop(first.child, first.exited).catch(() => undefined)
    if (second && second.child.exitCode === null) await stop(second.child, second.exited).catch(() => undefined)
    if (third) await stop(third.child, third.exited).catch(() => undefined)
  }

  report.status = Object.values(report.checks).every(check => check.status === 'PASS')
    ? 'PASS'
    : 'FAIL'
  const reportPath = path.resolve(flags.report || path.join(work, 'single-instance-report.json'))
  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  for (const [name, check] of Object.entries(report.checks)) {
    console.log(`[${check.status}] ${name}${check.detail ? ': ' + check.detail : ''}`)
  }
  console.log('report: ' + reportPath)
  if (report.status !== 'PASS') process.exitCode = 1
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
