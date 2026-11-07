#!/usr/bin/env node
/**
 * Vault app-level E2E against a real installed build.
 *
 * The instrumented smoke build runs `VaultService` (the same service the UI
 * calls) after the startup gate allows; every step therefore goes through
 * Tauri invoke → Rust vault command → VaultState → the encrypted file.
 *
 * Launch 1 (no vault): create, store a secret, lock, wrong password, unlock,
 * read, rotate the password, old password rejected, new password accepted,
 * lock. Launch 2 (same HOME): old password rejected, new password unlocks and
 * the secret is still readable. That is restart persistence.
 *
 * The probe prints booleans only; this harness fails if any test password or
 * secret appears in the application log.
 *
 * Usage:
 *   node vault-app-e2e.mjs --app <Termius.app> --work-dir <dir> \
 *     [--report <report.json>]
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const IDENTIFIER = 'com.baicie.termius'
const FORBIDDEN_LOGGED_VALUES = [
  'phase9.7-vault-one-time-password-1',
  'phase9.7-vault-one-time-password-2',
  'phase9.7-vault-one-time-secret',
  'phase9.7-not-the-password',
]

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

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function dataDir(home) {
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', IDENTIFIER)
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', IDENTIFIER)
  }
  return path.join(home, '.config', IDENTIFIER)
}

function launch(binary, home, logPath, extraEnv = {}) {
  const chunks = []
  let child
  try {
    child = spawn(binary, [], {
      cwd: os.tmpdir(),
      env: { ...process.env, HOME: home, SSH_AUTH_SOCK: '', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    return { child: null, exited: Promise.resolve({ code: null, signal: null }) }
  }
  child.stdout.on('data', chunk => chunks.push(chunk))
  child.stderr.on('data', chunk => chunks.push(chunk))
  const exited = new Promise(resolve => {
    child.on('error', () => resolve({ code: null, signal: null, spawnError: true }))
    child.on('exit', (code, signal) => {
      try {
        writeFileSync(logPath, Buffer.concat(chunks))
      } catch {
        // best effort
      }
      resolve({ code, signal })
    })
  })
  return {
    child,
    exited,
    logs: () => Buffer.concat(chunks).toString('utf8'),
    writeLog: () => writeFileSync(logPath, Buffer.concat(chunks)),
  }
}

async function waitForProbeFile(resultPath, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(resultPath)) {
      try {
        return JSON.parse(readFileSync(resultPath, 'utf8'))
      } catch {
        // a partially written file is retried
      }
    }
    await delay(200)
  }
  throw new Error('timed out waiting for ' + label)
}

async function stop(instance) {
  if (!instance.child) return
  if (instance.child.exitCode === null && instance.child.signalCode === null) {
    instance.child.kill('SIGTERM')
    const timer = setTimeout(() => {
      if (instance.child.exitCode === null && instance.child.signalCode === null) {
        instance.child.kill('SIGKILL')
      }
    }, 8_000)
    await instance.exited
    clearTimeout(timer)
  }
  instance.writeLog()
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const workRoot = path.resolve(flags['work-dir'] || os.tmpdir())
  mkdirSync(workRoot, { recursive: true })
  const work = mkdtempSync(path.join(workRoot, 'vault-app-'))
  const home = path.join(work, 'home')
  const logs = path.join(work, 'logs')
  mkdirSync(home, { recursive: true })
  mkdirSync(logs, { recursive: true })

  const report = {
    platform: process.platform,
    work,
    app: typeof flags.app === 'string' ? path.resolve(flags.app) : null,
    binary: null,
    binarySha256: null,
    checks: {},
    error: null,
    status: 'FAIL',
  }
  const add = (name, status, detail) => {
    report.checks[name] = { status, detail: detail || '' }
  }

  let first = null
  let second = null
  try {
    let binary = null
    if (report.app) {
      const candidate = path.join(report.app, 'Contents', 'MacOS', 'terminal')
      if (existsSync(candidate)) binary = candidate
    } else if (typeof flags.binary === 'string') {
      binary = path.resolve(flags.binary)
    }
    if (!binary || !existsSync(binary)) throw new Error('the application binary does not exist')
    if ((statSync(binary).mode & 0o111) === 0) throw new Error('the application binary is not executable')
    report.binary = binary
    report.binarySha256 = sha256File(binary)
    add('application binary resolved', 'PASS', binary + ' sha256=' + report.binarySha256)

    const db = path.join(dataDir(home), 'terminal.db')
    // Runtime marker: only this isolated data directory runs the probe.
    mkdirSync(path.dirname(db), { recursive: true })
    writeFileSync(path.join(path.dirname(db), 'vault-probe.enabled'), 'phase9.7\n')

    const firstResult = path.join(work, 'probe-1.json')
    first = launch(binary, home, path.join(logs, 'first.log'), {
      TERMINAL_VAULT_PROBE_RESULT: firstResult,
    })
    if (!first.child) throw new Error('the first launch could not be spawned')
    const created = await waitForProbeFile(firstResult, 180_000, 'the create-phase probe')
    add('vault created and secret stored', created.phase === 'create' && created.created ? 'PASS' : 'FAIL',
      JSON.stringify(created))
    add('wrong master password rejected', created.wrongRejected === true ? 'PASS' : 'FAIL', '')
    add('correct password reads the secret', created.secretOk === true ? 'PASS' : 'FAIL', '')
    add('master password rotated', created.rotated === true ? 'PASS' : 'FAIL', '')
    add('old password rejected after rotation', created.oldRejected === true ? 'PASS' : 'FAIL', '')
    add('new password reads the secret', created.afterRotation === true ? 'PASS' : 'FAIL', '')
    await stop(first)
    first = null
    add('first launch stopped', 'PASS', '')
    if (!existsSync(db)) add('database present', 'FAIL', db)

    const secondResult = path.join(work, 'probe-2.json')
    second = launch(binary, home, path.join(logs, 'second.log'), {
      TERMINAL_VAULT_PROBE_RESULT: secondResult,
    })
    if (!second.child) throw new Error('the second launch could not be spawned')
    const verified = await waitForProbeFile(secondResult, 180_000, 'the verify-phase probe')
    add('restart keeps the vault unlockable with the new password', verified.phase === 'verify' && verified.ok ? 'PASS' : 'FAIL',
      JSON.stringify(verified))
    add('old password still rejected after restart', verified.oldRejected === true ? 'PASS' : 'FAIL', '')
    add('secret survives the restart', verified.secretOk === true ? 'PASS' : 'FAIL', '')
    await stop(second)
    second = null

    const allLogs = readFileSync(path.join(logs, 'first.log'), 'utf8') +
      readFileSync(path.join(logs, 'second.log'), 'utf8')
    const leaked = FORBIDDEN_LOGGED_VALUES.filter(value => allLogs.includes(value))
    add('passwords and secret never appear in logs', leaked.length === 0 ? 'PASS' : 'FAIL',
      leaked.length === 0 ? '' : 'leaked: ' + leaked.join(','))
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    add('harness completed', 'FAIL', report.error)
  } finally {
    await stop(first).catch(() => undefined)
    await stop(second).catch(() => undefined)
  }

  report.status = Object.values(report.checks).some(check => check.status === 'FAIL')
    ? 'FAIL'
    : 'PASS'
  const reportPath = path.resolve(flags.report || path.join(work, 'vault-app-report.json'))
  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  for (const [name, check] of Object.entries(report.checks)) {
    console.log(`[${check.status}] ${name}${check.detail ? ': ' + check.detail : ''}`)
  }
  console.log('report: ' + reportPath)
  if (report.status !== 'PASS') process.exitCode = 1
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
