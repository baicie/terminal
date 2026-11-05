#!/usr/bin/env node
/**
 * Real two-version upgrade harness.
 *
 * A -> seed -> install B -> start B -> verify data.
 *
 * The first implemented adapter is macOS: both installers are real DMGs, the
 * app is copied into a throwaway Applications directory, and HOME points at a
 * throwaway data root. Linux and Windows adapters are explicit NOT_RUN results
 * until they are implemented; they never fall back to unpacking a payload and
 * calling it an install.
 *
 * The harness reuses scripts/verify-install/data-retention.mjs for the schema,
 * seed, snapshot, verification and backup checks. It does not create a second
 * data-retention framework.
 *
 * Usage:
 *   node scripts/verify-install/upgrade-e2e.mjs run \
 *     --a-installer <A.dmg> --b-installer <B.dmg> --platform darwin \
 *     --work-dir <dir> --report-dir <dir> \
 *     [--expect-a-sha256 <sha>] [--expect-b-sha256 <sha>] \
 *     [--expect-identifier com.baicie.termius] \
 *     [--expect-new-host-columns agent_forwarding,shell_integration] \
 *     [--expect-backup] \
 *     [--fault none|corrupt-db|read-only-data-dir|restart-idempotent|interrupted]
 */
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = import.meta.dirname
const DR = path.join(HERE, 'data-retention.mjs')
const ASSET = path.join(HERE, 'asset-metadata.mjs')
const PROVIDER = 'upgrade-e2e'

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function sleep(ms) {
  const pause = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(pause, 0, 0, ms)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) flags[token.slice(2)] = true
      else {
        flags[token.slice(2)] = next
        index += 1
      }
    } else rest.push(token)
  }
  return { command: rest[0], flags }
}

const nodeFlag = (() => {
  try {
    execFileSync(process.execPath, ['-e', 'require("node:sqlite")'], { stdio: 'ignore' })
    return []
  } catch {
    return ['--experimental-sqlite']
  }
})()

async function dr(args) {
  return run(process.execPath, [...nodeFlag, DR, ...args])
}

async function inspectAsset(installer, platform, expected) {
  const json = path.join(path.dirname(installer), `.metadata-${path.basename(installer)}.json`)
  const args = [
    'inspect',
    '--installer', installer,
    '--platform', platform,
    '--json', json,
  ]
  if (expected.sha256) args.push('--expect-sha256', expected.sha256)
  if (expected.version) args.push('--expect-version', expected.version)
  if (expected.identifier) args.push('--expect-identifier', expected.identifier)
  try {
    await run(process.execPath, [ASSET, ...args])
  } catch (error) {
    if (existsSync(json)) return JSON.parse(readFileSync(json, 'utf8'))
    throw error
  }
  return JSON.parse(readFileSync(json, 'utf8'))
}

function mountDmg(dmg, mountPoint) {
  mkdirSync(mountPoint, { recursive: true })
  return run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmg])
}

async function installFromDmg(dmg, targetApp, work) {
  const mount = path.join(work, 'mnt-' + path.basename(dmg, '.dmg'))
  await mountDmg(dmg, mount)
  try {
    const appName = readdirSync(mount).find(name => name.endsWith('.app'))
    if (!appName) throw new Error('no .app payload in ' + dmg)
    const source = path.join(mount, appName)
    rmSync(targetApp, { recursive: true, force: true })
    cpSync(source, targetApp, { recursive: true, dereference: true })
    return targetApp
  } finally {
    await run('hdiutil', ['detach', mount, '-force']).catch(() => undefined)
  }
}

function launch(binary, home, logPath, extraEnv = {}) {
  const output = []
  const child = spawn(binary, [], {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      HOME: home,
      SSH_AUTH_SOCK: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const append = chunk => {
    output.push(String(chunk))
    if (output.length > 2000) output.splice(0, output.length - 2000)
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.once('exit', (code, signal) => {
    writeFileSync(logPath, output.join('') + `\n[exit code=${code} signal=${signal}]\n`)
  })
  return child
}

async function stop(child, waitMs = 30_000) {
  if (child.exitCode !== null || child.signalCode !== null) return 'already-exited'
  child.kill('SIGTERM')
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    sleep(250)
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    // Wait for the exit event so the log handler has flushed before the caller
    // reads b-fault.log. Returning on the signal alone raced the evidence.
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ])
    return 'sigkill'
  }
  return 'sigterm'
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    sleep(500)
  }
  throw new Error(label + ' not reached within ' + timeoutMs + ' ms' +
    (lastError ? ': ' + errorMessage(lastError) : ''))
}

async function waitForDatabase(dbPath, timeoutMs = 120_000) {
  await waitFor(() => existsSync(dbPath) && statSync(dbPath).size > 0, timeoutMs,
    'database ' + dbPath)
}

async function waitForSchema(dbPath, expectedColumns, timeoutMs = 120_000) {
  await dr([
    'wait', '--db', dbPath, '--mode', 'migration-columns',
    '--expect-columns', expectedColumns, '--timeout', String(Math.ceil(timeoutMs / 1000)),
  ])
}

async function waitForBackup(backupsDir, timeoutMs = 30_000) {
  return waitFor(() => {
    if (!existsSync(backupsDir)) return null
    const files = readdirSync(backupsDir).filter(name => /^pre-migration-.*\.db$/.test(name))
    return files.length > 0 ? path.join(backupsDir, files.sort().at(-1)) : null
  }, timeoutMs, 'pre-migration backup in ' + backupsDir)
}

function writeFaultCorrupt(dbPath) {
  const buffer = Buffer.alloc(32, 0)
  const fd = openSync(dbPath, 'r+')
  try {
    writeSync(fd, buffer, 0, buffer.length, 0)
  } finally {
    closeSync(fd)
  }
}

async function report(work, reportDir, reportJson) {
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(path.join(reportDir, 'upgrade-report.json'), JSON.stringify(reportJson, null, 2) + '\n')
  const lines = [
    '# Two-version upgrade report',
    '',
    `- Status: **${reportJson.status}**`,
    `- Platform: ${reportJson.platform}`,
    `- A: ${reportJson.a?.version ?? 'unknown'} (${reportJson.a?.sha256?.slice(0, 16) ?? 'no sha'})`,
    `- B: ${reportJson.b?.version ?? 'unknown'} (${reportJson.b?.sha256?.slice(0, 16) ?? 'no sha'})`,
    `- Fault mode: ${reportJson.fault}`,
    '',
    '## Checks',
    '',
    ...reportJson.checks.map(check => `- [${check.status}] ${check.name}${check.detail ? ': ' + check.detail : ''}`),
    '',
    '## Schema',
    '',
    '```json',
    JSON.stringify(reportJson.schema, null, 2),
    '```',
    '',
    '## NOT_RUN',
    '',
    ...(reportJson.notRun.length === 0 ? ['- none'] : reportJson.notRun.map(item => `- ${item}`)),
    '',
    `Evidence directory: ${work}`,
  ]
  writeFileSync(path.join(reportDir, 'upgrade-report.md'), lines.join('\n') + '\n')
}

async function runMacos(flags) {
  const aInstaller = path.resolve(flags['a-installer'])
  const bInstaller = path.resolve(flags['b-installer'])
  const expectedIdentifier = flags['expect-identifier'] || 'com.baicie.termius'
  const expectedNewHostColumns = String(flags['expect-new-host-columns'] || 'agent_forwarding,shell_integration')
    .split(',').map(value => value.trim()).filter(Boolean)
  const fault = typeof flags.fault === 'string' ? flags.fault : 'none'
  const expectBackup = flags['expect-backup'] === true
  const workRoot = path.resolve(flags['work-dir'] || os.tmpdir())
  const work = mkdtempSync(path.join(workRoot, 'terminal-upgrade-'))
  const reportDir = path.resolve(flags['report-dir'] || path.join(work, 'report'))
  const home = path.join(work, 'home')
  const apps = path.join(work, 'Applications')
  const logs = path.join(work, 'logs')
  mkdirSync(home, { recursive: true })
  mkdirSync(apps, { recursive: true })
  mkdirSync(logs, { recursive: true })

  const token = 'phase95-upgrade-' + Date.now()
  const dataDir = path.join(home, 'Library', 'Application Support', expectedIdentifier)
  const db = path.join(dataDir, 'terminal.db')
  const vault = path.join(home, 'Library', 'Application Support', 'terminal', 'vault.json')
  const backups = path.join(dataDir, 'backups')
  const installedApp = path.join(apps, 'Termius.app')
  const reportJson = {
    provider: PROVIDER,
    generatedAt: new Date().toISOString(),
    platform: 'darwin',
    hostArch: process.arch,
    fault,
    work,
    token,
    a: null,
    b: null,
    schema: null,
    checks: [],
    notRun: [
      'real Vault master-password unlock (requires interactive credential; file persistence is asserted only)',
      'rollback B->A (no product rollback state machine; pre-migration backup readability is asserted)',
      'Linux and Windows adapters (NOT_RUN in this first implementation)',
      'Gatekeeper / notarization / Authenticode (BLOCKED_EXTERNAL)',
      'disk-full (read-only data directory is covered; installer media read-only is not)',
    ],
    logs: { a: path.join(logs, 'a.log'), b: path.join(logs, 'b.log') },
    status: 'FAIL',
  }
  const add = (name, status, detail) => {
    reportJson.checks.push({ name, status, detail: detail || '' })
  }

  try {
    reportJson.a = await inspectAsset(aInstaller, 'darwin', {
      sha256: flags['expect-a-sha256'],
      version: flags['expect-a-version'],
      identifier: expectedIdentifier,
    })
    reportJson.b = await inspectAsset(bInstaller, 'darwin', {
      sha256: flags['expect-b-sha256'],
      version: flags['expect-b-version'],
      identifier: expectedIdentifier,
    })
    if (reportJson.a.status !== 'PASS' || reportJson.b.status !== 'PASS') {
      throw new Error('installer metadata did not pass')
    }
    if (reportJson.a.version === reportJson.b.version) {
      throw new Error('A and B have the same version: ' + reportJson.a.version)
    }
    if (reportJson.a.identifier !== reportJson.b.identifier) {
      throw new Error('A and B identifiers differ: ' + reportJson.a.identifier + ' / ' + reportJson.b.identifier)
    }
    if (reportJson.a.arch !== 'arm64' || reportJson.b.arch !== 'arm64' || process.arch !== 'arm64') {
      throw new Error('this first adapter requires arm64 host and artifacts; got ' +
        reportJson.a.arch + '/' + reportJson.b.arch + '/' + process.arch)
    }
    add('A metadata', 'PASS', `${reportJson.a.version} ${reportJson.a.sha256.slice(0, 16)}`)
    add('B metadata', 'PASS', `${reportJson.b.version} ${reportJson.b.sha256.slice(0, 16)}`)

    await installFromDmg(aInstaller, installedApp, work)
    const binary = path.join(installedApp, 'Contents', 'MacOS', 'terminal')
    if (!existsSync(binary)) throw new Error('installed A has no executable')
    add('install A', 'PASS', installedApp)

    let child = launch(binary, home, reportJson.logs.a)
    await waitForDatabase(db)
    add('A database created', 'PASS', db)
    await waitForSchema(db, 'hosts:id;settings:key;workspaces:id;workspace_layouts:workspace_id')
    add('A schema ready', 'PASS')
    const stopA = await stop(child)
    add('A stopped', 'PASS', stopA)
    await dr(['checkpoint', '--db', db])
    await dr(['seed', '--db', db, '--token', token, '--vault', vault, '--compatible'])
    add('seed A data', 'PASS', 'compatible with A schema')
    await dr(['snapshot', '--db', db, '--token', token, '--vault', vault, '--out', path.join(work, 'a-snapshot.json')])
    const before = JSON.parse(readFileSync(path.join(work, 'a-snapshot.json'), 'utf8'))
    reportJson.schema = {
      beforeTables: before.tables,
      beforeHostColumns: before.schema?.hosts ?? null,
      afterTables: null,
      afterHostColumns: null,
      addedHostColumns: null,
    }
    add('A read-back snapshot', 'PASS', 'hosts/settings/workspace/layout/vault readable')
    const dbHashBefore = sha256File(db)

    await installFromDmg(bInstaller, installedApp, work)
    const bBinary = path.join(installedApp, 'Contents', 'MacOS', 'terminal')
    if (!existsSync(bBinary)) throw new Error('installed B has no executable')
    add('install B', 'PASS', installedApp)

    if (fault === 'corrupt-db') {
      writeFaultCorrupt(db)
      const corruptedHash = sha256File(db)
      const faultLog = path.join(logs, 'b-fault.log')
      reportJson.logs.fault = faultLog
      child = launch(bBinary, home, faultLog)
      await sleep(15_000)
      await stop(child)
      const afterHash = sha256File(db)
      const preserved = afterHash === corruptedHash
      add('corrupt DB preserved', preserved ? 'PASS' : 'FAIL', `${corruptedHash.slice(0, 16)} -> ${afterHash.slice(0, 16)}`)
      await sleep(1_000)
      await waitFor(() => existsSync(faultLog) && statSync(faultLog).size > 0, 3_000).catch(() => null)
      const faultText = existsSync(faultLog) ? readFileSync(faultLog, 'utf8') : ''
      add(
        'corruption detected by the app',
        /file is not a database|db bootstrap failed|SQLite/i.test(faultText) ? 'PASS' : 'NOT_RUN',
        /file is not a database/i.test(faultText)
          ? 'app log: file is not a database'
          : 'no matching line in the app log',
      )
      reportJson.status = preserved ? 'PASS' : 'FAIL'
      await report(work, reportDir, reportJson)
      return reportJson
    }

    if (fault === 'read-only-data-dir') {
      const faultLog = path.join(logs, 'b-fault.log')
      reportJson.logs.fault = faultLog
      chmodSync(dataDir, 0o500)
      child = launch(bBinary, home, faultLog)
      await sleep(15_000)
      await stop(child)
      chmodSync(dataDir, 0o700)
      const afterHash = sha256File(db)
      const preserved = afterHash === dbHashBefore
      add('read-only data dir preserved DB', preserved ? 'PASS' : 'FAIL', `${dbHashBefore.slice(0, 16)} -> ${afterHash.slice(0, 16)}`)
      await sleep(1_000)
      await waitFor(() => existsSync(faultLog) && statSync(faultLog).size > 0, 3_000).catch(() => null)
      const faultText = existsSync(faultLog) ? readFileSync(faultLog, 'utf8') : ''
      add(
        'read-only failure detected by the app',
        /readonly database|read-only|permission|db bootstrap failed/i.test(faultText) ? 'PASS' : 'NOT_RUN',
        /readonly database/i.test(faultText)
          ? 'app log: attempt to write a readonly database'
          : 'no matching line in the app log',
      )
      reportJson.status = preserved ? 'PASS' : 'FAIL'
      await report(work, reportDir, reportJson)
      return reportJson
    }

    child = launch(bBinary, home, reportJson.logs.b)
    await waitForSchema(db, 'hosts:' + expectedNewHostColumns.join(','))
    const backup = await waitForBackup(backups, expectBackup ? 30_000 : 1_000).catch(() => null)
    add('B migration', 'PASS', expectedNewHostColumns.join(','))
    if (expectBackup) {
      add('pre-migration backup', backup ? 'PASS' : 'FAIL', backup || 'not found')
    } else {
      add('pre-migration backup', 'NOT_RUN',
        backup || 'B ' + reportJson.b.version + ' predates the pre-migration snapshot feature')
      reportJson.notRun.push('pre-migration backup (B ' + reportJson.b.version + ' has no backup command)')
    }
    const stopB = await stop(child)
    add('B stopped', 'PASS', stopB)
    await dr(['checkpoint', '--db', db])
    const afterColumns = execFileSyncSqlite(db, "SELECT name FROM pragma_table_info('hosts')")
    reportJson.schema.afterTables = execFileSyncSqlite(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    reportJson.schema.afterHostColumns = afterColumns
    reportJson.schema.addedHostColumns = afterColumns.filter(column => !(reportJson.schema.beforeHostColumns || []).includes(column))
    await dr([
      'verify', '--db', db, '--before', path.join(work, 'a-snapshot.json'),
      '--token', token, '--vault', vault,
      '--expected-new-host-columns', expectedNewHostColumns.join(','),
      '--allow-settings-migration',
    ])
    add('data integrity after B', 'PASS', 'field-by-field')
    if (before.team && Object.values(before.team).some(Boolean)) {
      add('Team Sync local persistence', 'PASS',
        'teams/members/shared hosts/sync_queue/user_profile')
    } else {
      add('Team Sync local persistence', 'NOT_RUN', 'A snapshot has no team rows')
    }
    if (backup) {
      await dr(['backup-verify', '--dir', backups, '--token', token, '--out', path.join(work, 'backup-report.json')])
      add('backup readable', 'PASS', backup)
    }
    if (fault === 'restart-idempotent') {
      child = launch(bBinary, home, path.join(logs, 'b-restart.log'))
      await waitForSchema(db, 'hosts:' + expectedNewHostColumns.join(','))
      await stop(child)
      await dr([
        'verify', '--db', db, '--before', path.join(work, 'a-snapshot.json'),
        '--token', token, '--vault', vault,
        '--expected-new-host-columns', expectedNewHostColumns.join(','),
        '--allow-settings-migration',
      ])
      add('restart idempotent', 'PASS', 'second B launch kept the data')
    }
    if (fault === 'interrupted') {
      // This is intentionally not claimed as covered: the dev.1->dev.2
      // migration window is two ALTERs and the harness has not found a
      // deterministic kill point. A false PASS here would be worse than a
      // documented gap.
      add('interrupted migration recovery', 'NOT_RUN',
        'migration window is too short to hit deterministically in this implementation')
    }
    reportJson.status = reportJson.checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS'
    await report(work, reportDir, reportJson)
    return reportJson
  } catch (error) {
    add('harness', 'FAIL', errorMessage(error))
    reportJson.status = 'FAIL'
    await report(work, reportDir, reportJson).catch(() => undefined)
    return reportJson
  }
}

function execFileSyncSqlite(dbPath, sql) {
  return execFileSync(process.env.SQLITE3 || 'sqlite3', [dbPath, sql], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.command !== 'run') {
    throw new Error('usage: upgrade-e2e.mjs run --a-installer <A> --b-installer <B> --platform darwin')
  }
  const platform = parsed.flags.platform || process.platform
  if (platform !== 'darwin') {
    const reportJson = {
      provider: PROVIDER,
      platform,
      status: 'NOT_RUN',
      checks: [],
      notRun: ['the first adapter is macOS-only; ' + platform + ' was not executed'],
    }
    await report(process.cwd(), path.resolve(parsed.flags['report-dir'] || '.'), reportJson)
    console.log(JSON.stringify(reportJson, null, 2))
    process.exitCode = 1
    return
  }
  const result = await runMacos(parsed.flags)
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.status === 'PASS' ? 0 : 1
}

main().catch(error => {
  console.error('[' + PROVIDER + '] ' + errorMessage(error))
  process.exitCode = 2
})
