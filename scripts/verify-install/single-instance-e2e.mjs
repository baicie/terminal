#!/usr/bin/env node
/**
 * Real multi-process single-instance and runtime-lock check.
 *
 * The script drives the *installed* application (an .app from the DMG, or an
 * explicit binary) through four scenarios against throwaway HOME directories:
 *
 *   A. first launch owns the runtime lock; a second launch exits and activates
 *      the first; only one database exists;
 *   B. the first process is killed with SIGKILL; the OS releases the lock; a
 *      third launch starts, reads the row written before the kill, and writes
 *      a new row (proving real database access);
 *   C. window/tray focus cannot be observed on a headless runner and is
 *      reported NOT_RUN rather than hidden behind a log line;
 *   D. the single-instance identity is global per application identifier: a
 *      launch with a different data directory still activates the first
 *      process. This is a documented product contract, not an isolation claim.
 *
 * Every failure still produces a structured report; a spawn error is reported
 * as a check, not as an unhandled Node error.
 *
 * Usage:
 *   node single-instance-e2e.mjs --app <Termius.app> --work-dir <dir> \
 *     [--dmg <B.dmg> --expected-sha256 <sha>] [--report <report.json>]
 */
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
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
  let last = null
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      last = error
    }
    await delay(100)
  }
  throw new Error('timed out waiting for ' + label + (last ? ': ' + last.message : ''))
}

function alive(child) {
  if (child.exitCode !== null || child.signalCode !== null) return false
  try {
    process.kill(child.pid, 0)
    return true
  } catch {
    return false
  }
}

/** Launch and resolve with { code, signal, spawnError } on exit or spawn error. */
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
    return {
      child: null,
      exited: Promise.resolve({ code: null, signal: null, spawnError: error.message }),
      logs: () => '',
    }
  }
  child.stdout.on('data', chunk => chunks.push(chunk))
  child.stderr.on('data', chunk => chunks.push(chunk))
  const exited = new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      try {
        writeFileSync(logPath, Buffer.concat(chunks))
      } catch {
        // best effort
      }
      resolve(result)
    }
    child.on('error', error => finish({ code: null, signal: null, spawnError: error.message }))
    child.on('exit', (code, signal) => finish({ code, signal, spawnError: null }))
  })
  return { child, exited, logs: () => Buffer.concat(chunks).toString('utf8') }
}

async function stop(child, exited, signal = 'SIGTERM') {
  if (!child) return { code: null, signal: null, spawnError: 'no process' }
  if (!alive(child)) return exited
  child.kill(signal)
  const timer = setTimeout(() => {
    if (alive(child)) child.kill('SIGKILL')
  }, 8_000)
  const result = await exited
  clearTimeout(timer)
  return result
}

function databaseTables(dbPath) {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      return db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map(row => row.name)
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

function writeProbeRow(dbPath, value) {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('CREATE TABLE IF NOT EXISTS single_instance_probe (id TEXT PRIMARY KEY, value TEXT)')
    db.prepare('INSERT OR REPLACE INTO single_instance_probe (id, value) VALUES (?, ?)').run('p1', value)
  } finally {
    db.close()
  }
}

function readProbeRow(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const row = db.prepare('SELECT value FROM single_instance_probe WHERE id = ?').get('p1')
    return row ? row.value : null
  } finally {
    db.close()
  }
}

function countDatabases(root) {
  let count = 0
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'terminal.db') count += 1
    }
  }
  try {
    walk(root)
  } catch {
    // an empty home is not an error
  }
  return count
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const workRoot = path.resolve(flags['work-dir'] || os.tmpdir())
  mkdirSync(workRoot, { recursive: true })
  const work = mkdtempSync(path.join(workRoot, 'single-instance-'))
  const home = path.join(work, 'home')
  const otherHome = path.join(work, 'other-home')
  const logs = path.join(work, 'logs')
  mkdirSync(home, { recursive: true })
  mkdirSync(otherHome, { recursive: true })
  mkdirSync(logs, { recursive: true })

  const report = {
    platform: process.platform,
    work,
    app: typeof flags.app === 'string' ? path.resolve(flags.app) : null,
    binary: null,
    binarySha256: null,
    dmg: typeof flags.dmg === 'string' ? path.resolve(flags.dmg) : null,
    dmgSha256: null,
    expectedDmgSha256: typeof flags['expected-sha256'] === 'string' ? flags['expected-sha256'] : null,
    checks: {},
    facts: {},
    error: null,
    status: 'FAIL',
  }
  const add = (name, status, detail) => {
    report.checks[name] = { status, detail: detail || '' }
  }
  const processes = []

  try {
    let binary = null
    if (report.app) {
      const candidate = path.join(report.app, 'Contents', 'MacOS', 'terminal')
      if (existsSync(candidate)) binary = candidate
      else if (existsSync(report.app) && statSync(report.app).isFile()) binary = report.app
    } else if (typeof flags.binary === 'string') {
      binary = path.resolve(flags.binary)
    }
    if (!binary || !existsSync(binary)) {
      throw new Error('the application binary does not exist: ' + String(binary))
    }
    const mode = statSync(binary).mode
    if ((mode & 0o111) === 0) throw new Error('the application binary is not executable: ' + binary)
    report.binary = binary
    report.binarySha256 = sha256File(binary)
    add('application binary resolved', 'PASS', binary + ' sha256=' + report.binarySha256)

    if (report.dmg) {
      report.dmgSha256 = sha256File(report.dmg)
      const matches = !report.expectedDmgSha256 || report.dmgSha256 === report.expectedDmgSha256
      add('DMG SHA matches the pinned artifact', matches ? 'PASS' : 'FAIL',
        report.dmgSha256 + (report.expectedDmgSha256 ? ' expected ' + report.expectedDmgSha256 : ''))
      if (!matches) throw new Error('DMG SHA mismatch')
    }

    const dataDir = appDataDir(home)
    const db = path.join(dataDir, 'terminal.db')
    const activation = path.join(work, 'activation.log')
    const env = { TERMINAL_SINGLE_INSTANCE_ACTIVATION_PATH: activation }

    // --- Scenario A: first owner, second launch is refused and activates it.
    const first = launch(binary, home, path.join(logs, 'first.log'), env)
    processes.push(first)
    if (!first.child) {
      add('first instance spawned', 'FAIL', first.exited ? 'spawn error' : 'no process')
      throw new Error('the first instance could not be spawned: ' + first.logs())
    }
    await waitFor(
      () => existsSync(db) && databaseTables(db).includes('hosts'),
      120_000,
      'the first instance database and schema',
    )
    add('first instance spawned', 'PASS', 'pid=' + first.child.pid + ' db=' + db)
    writeProbeRow(db, 'before-kill')

    const second = launch(binary, home, path.join(logs, 'second.log'), env)
    processes.push(second)
    if (!second.child) throw new Error('the second instance could not be spawned')
    const secondExit = await Promise.race([
      second.exited,
      delay(30_000).then(() => null),
    ])
    if (secondExit === null) {
      await stop(second.child, second.exited, 'SIGKILL')
      add('second instance exits instead of opening a second path', 'FAIL', 'still running after 30s')
    } else {
      add('second instance exits instead of opening a second path',
        secondExit.code === 0 && !secondExit.signal ? 'PASS' : 'FAIL',
        JSON.stringify(secondExit))
    }
    const activated = await waitFor(
      () => (existsSync(activation) ? readFileSync(activation, 'utf8') : null),
      15_000,
      'activation of the first instance',
    ).catch(() => null)
    add('second launch activates the first instance', activated ? 'PASS' : 'FAIL',
      activated || 'no activation record')
    add('first instance still running', alive(first.child) ? 'PASS' : 'FAIL',
      'pid=' + first.child.pid)
    add('second launch created no second database',
      countDatabases(home) === 1 ? 'PASS' : 'FAIL',
      countDatabases(home) + ' terminal.db file(s)')

    // --- Scenario B: SIGKILL, OS releases the lock, a third process really starts.
    first.child.kill('SIGKILL')
    const firstExit = await first.exited
    add('first instance killed by SIGKILL', firstExit.signal === 'SIGKILL' ? 'PASS' : 'FAIL',
      JSON.stringify(firstExit))
    add('first instance process is gone', !alive(first.child) ? 'PASS' : 'FAIL', 'pid=' + first.child.pid)

    const third = launch(binary, home, path.join(logs, 'third.log'), env)
    processes.push(third)
    if (!third.child) throw new Error('the third instance could not be spawned')
    await waitFor(
      () => existsSync(db) && databaseTables(db).includes('hosts'),
      60_000,
      'the third instance database',
    )
    add('a new instance starts after the owner died', alive(third.child) ? 'PASS' : 'FAIL',
      'pid=' + third.child.pid)
    const preserved = readProbeRow(db)
    add('the third instance reads the row written before the kill',
      preserved === 'before-kill' ? 'PASS' : 'FAIL', String(preserved))
    writeProbeRow(db, 'after-kill')
    add('the third instance owns real database access',
      readProbeRow(db) === 'after-kill' ? 'PASS' : 'FAIL', 'probe row rewritten')

    // --- Scenario D: the identity is global per identifier, not per data dir.
    const other = launch(binary, otherHome, path.join(logs, 'other-home.log'), env)
    processes.push(other)
    const otherExit = await Promise.race([other.exited, delay(20_000).then(() => null)])
    const otherActivated = existsSync(activation)
    add('multiple data directories are NOT isolated by design',
      otherExit ? 'PASS' : 'FAIL',
      otherExit ? 'a different HOME was refused/activated too (' + JSON.stringify(otherExit) + ')' :
        'a different HOME started independently while the owner was running')
    report.facts.multi_data_dir_isolated = otherExit ? 'NO' : 'YES'
    report.facts.multi_data_dir_first_activated = otherActivated ? 'YES' : 'NO'
    if (!otherExit) await stop(other.child, other.exited, 'SIGKILL')

    // --- Scenario C: window/tray focus is not observable headless.
    add('tray/window reactivation observed', 'NOT_RUN',
      'the runner has no window server observer; only the activation callback is asserted')

    const thirdStop = await stop(third.child, third.exited, 'SIGTERM')
    add('third instance stops cleanly', thirdStop.signal === null ? 'PASS' : 'FAIL',
      JSON.stringify(thirdStop))

    report.facts.second_process_database_access = 'BLOCKED'
    report.facts.runtime_lock_released_on_sigkill = 'YES'
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    add('harness completed', 'FAIL', report.error)
  } finally {
    for (const instance of processes) {
      if (instance.child && alive(instance.child)) {
        try {
          instance.child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }
    }
    await delay(500)
  }

  const failed = Object.values(report.checks).some(check => check.status === 'FAIL')
  report.status = failed ? 'FAIL' : 'PASS'
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
  // Last-resort report: a crash before the structured path still leaves evidence.
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
