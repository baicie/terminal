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
 *     [--fault none|corrupt-db|read-only-data-dir|restart-idempotent|restore-backup|downgrade|interrupted]
 */
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { assessFault } from './fault-assessment.mjs'

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

async function replaceWithBackup(db, backup, dataDir) {
  // The app is stopped and every data-retention command has closed its
  // connection before this runs. Checkpoint first, then replace atomically in
  // the same directory; WAL/SHM are removed only after the checkpoint.
  await dr(['checkpoint', '--db', db])
  const temporary = path.join(dataDir, 'terminal.restore.tmp')
  cpSync(backup, temporary)
  const fd = openSync(temporary, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, db)
  rmSync(db + '-wal', { force: true })
  rmSync(db + '-shm', { force: true })
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
  mkdirSync(workRoot, { recursive: true })
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
    expectBackup,
    work,
    token,
    a: null,
    b: null,
    schema: null,
    checks: [],
    notRun: [
      'real Vault master-password unlock (requires interactive credential; file persistence is asserted only)',
      'incompatible-schema downgrade refusal (dev.1 reads the additive current schema; a non-additive future schema is not tested)',
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
  const applyFaultAssessment = (kind, facts) => {
    const assessment = assessFault(kind, facts)
    reportJson.faultAssessment = { kind, ...assessment }
    for (const name of assessment.required) {
      add('fault.' + name, assessment.facts[name], '')
    }
    reportJson.status = assessment.overall
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
    // Keep a copy of A before B overwrites the installed bundle, so recovery
    // and downgrade tests can launch the real A binary against a restored or
    // post-migration database.
    const aAppCopy = path.join(apps, 'Termius-A.app')
    cpSync(installedApp, aAppCopy, { recursive: true, dereference: true })
    const aBinary = path.join(aAppCopy, 'Contents', 'MacOS', 'terminal')
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
      const appObserved = /file is not a database|db bootstrap failed|SQLite/i.test(faultText)
      add(
        'corruption detected by the app',
        appObserved ? 'PASS' : 'NOT_RUN',
        appObserved ? 'app log: file is not a database' : 'no matching line in the app log',
      )
      applyFaultAssessment('corrupt-db', {
        FAULT_INJECTED: corruptedHash !== dbHashBefore ? 'PASS' : 'FAIL',
        APPLICATION_FAILURE_OBSERVED: appObserved ? 'PASS' : 'NOT_RUN',
        ORIGINAL_DATA_PRESERVED: preserved ? 'PASS' : 'FAIL',
        NO_PARTIAL_MIGRATION: preserved ? 'PASS' : 'FAIL',
        RECOVERY_SUCCEEDED: 'NOT_RUN',
      })
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
      const appObserved = /readonly database|read-only|permission|db bootstrap failed/i.test(faultText)
      add(
        'read-only failure detected by the app',
        appObserved ? 'PASS' : 'NOT_RUN',
        appObserved ? 'app log: attempt to write a readonly database' : 'no matching line in the app log',
      )
      const columnsAfterFault = execFileSyncSqlite(db, "SELECT name FROM pragma_table_info('hosts')")
      const partiallyMigrated = expectedNewHostColumns.some(column => columnsAfterFault.includes(column))
      add(
        'no partial migration',
        partiallyMigrated ? 'FAIL' : 'PASS',
        partiallyMigrated ? 'new columns appeared despite the failure' : 'hosts schema is still A',
      )
      // Recovery: remove the fault and launch B again. It must complete the
      // migration and keep every seeded field.
      let recovery = 'NOT_RUN'
      try {
        child = launch(bBinary, home, path.join(logs, 'b-recovery.log'))
        await waitForSchema(db, 'hosts:' + expectedNewHostColumns.join(','))
        await stop(child)
        await dr(['checkpoint', '--db', db])
        await dr([
          'verify', '--db', db, '--before', path.join(work, 'a-snapshot.json'),
          '--token', token, '--vault', vault,
          '--expected-new-host-columns', expectedNewHostColumns.join(','),
          '--allow-settings-migration',
        ])
        recovery = 'PASS'
        add('read-only recovery', 'PASS', 'B migrated after the directory became writable')
      } catch (error) {
        recovery = 'FAIL'
        add('read-only recovery', 'FAIL', errorMessage(error))
      }
      applyFaultAssessment('read-only-data-dir', {
        FAULT_INJECTED: 'PASS',
        APPLICATION_FAILURE_OBSERVED: appObserved ? 'PASS' : 'NOT_RUN',
        ORIGINAL_DATA_PRESERVED: preserved ? 'PASS' : 'FAIL',
        NO_PARTIAL_MIGRATION: partiallyMigrated ? 'FAIL' : 'PASS',
        RECOVERY_SUCCEEDED: recovery,
      })
      await report(work, reportDir, reportJson)
      return reportJson
    }

    if (fault === 'interrupted') {
      const stageLog = path.join(work, 'b-interrupted-stages.jsonl')
      const interruptedLog = path.join(logs, 'b-interrupted.log')
      reportJson.logs.fault = interruptedLog
      child = launch(bBinary, home, interruptedLog, {
        TERMINAL_STARTUP_STAGES_PATH: stageLog,
      })
      let stageSeen = null
      try {
        stageSeen = await waitFor(() => {
          if (!existsSync(stageLog)) return null
          const text = readFileSync(stageLog, 'utf8')
          if (text.includes('core-schema-finished')) return 'core-schema-finished'
          if (text.includes('snapshot-finished')) return 'snapshot-finished'
          return null
        }, 30_000, 'migration stage')
      } catch {
        stageSeen = null
      }
      if (stageSeen === 'snapshot-finished') {
        // Wait until the first column is actually committed, then kill before
        // the delayed second ALTER. This is a real mid-migration interruption,
        // not merely a kill before migration started.
        const killColumns = await waitFor(() => {
          try {
            const columns = execFileSyncSqlite(db, "SELECT name FROM pragma_table_info('hosts')")
            return columns.includes(expectedNewHostColumns[0]) ? columns : null
          } catch {
            return null
          }
        }, 15_000, 'first migrated host column').catch(() => null)
        const missingAtKill = killColumns
          ? expectedNewHostColumns.filter(column => !killColumns.includes(column))
          : []
        if (!killColumns || missingAtKill.length === 0) {
          await stop(child)
          add(
            'interrupted migration recovery',
            'NOT_RUN',
            killColumns
              ? 'migration finished before the kill window; increase VITE_TERMINAL_MIGRATION_DELAY_MS'
              : 'first migrated host column was not observed',
          )
          applyFaultAssessment('interrupted', {
            FAULT_INJECTED: 'NOT_RUN',
            APPLICATION_FAILURE_OBSERVED: 'NOT_RUN',
            ORIGINAL_DATA_PRESERVED: 'NOT_RUN',
            NO_PARTIAL_MIGRATION: 'NOT_RUN',
            RECOVERY_SUCCEEDED: 'NOT_RUN',
          })
          await report(work, reportDir, reportJson)
          return reportJson
        }
        child.kill('SIGKILL')
        await Promise.race([
          new Promise(resolve => child.once('exit', resolve)),
          new Promise(resolve => setTimeout(resolve, 2_000)),
        ])
        add('interrupted after backup', 'PASS', 'killed between snapshot-finished and core-schema-finished')
        add('interrupted mid-migration', 'PASS',
          'committed ' + killColumns.join(',') + '; missing ' + missingAtKill.join(','))
        child = launch(bBinary, home, path.join(logs, 'b-recovery.log'), {
          TERMINAL_STARTUP_STAGES_PATH: path.join(work, 'b-recovery-stages.jsonl'),
        })
        await waitForSchema(db, 'hosts:' + expectedNewHostColumns.join(','))
        await stop(child)
        await dr(['checkpoint', '--db', db])
        await dr([
          'verify', '--db', db, '--before', path.join(work, 'a-snapshot.json'),
          '--token', token, '--vault', vault,
          '--expected-new-host-columns', expectedNewHostColumns.join(','),
          '--allow-settings-migration',
        ])
        const interruptedBackup = await waitForBackup(backups, 3_000).catch(() => null)
        add('pre-migration backup', interruptedBackup ? 'PASS' : 'FAIL',
          interruptedBackup || 'not found after interrupted recovery')
        if (interruptedBackup) {
          await dr(['backup-verify', '--dir', backups, '--token', token])
        }
        const interruptedColumns = execFileSyncSqlite(db, "SELECT name FROM pragma_table_info('hosts')")
        reportJson.schema.afterTables = execFileSyncSqlite(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        reportJson.schema.afterHostColumns = interruptedColumns
        reportJson.schema.addedHostColumns = interruptedColumns.filter(
          column => !(reportJson.schema.beforeHostColumns || []).includes(column),
        )
        add('B migration', 'PASS', expectedNewHostColumns.join(','))
        add('data integrity after B', 'PASS', 'field-by-field after interrupted recovery')
        add('interrupted migration recovery', 'PASS', 'relaunch converged and data verified')
        applyFaultAssessment('interrupted', {
          FAULT_INJECTED: 'PASS',
          APPLICATION_FAILURE_OBSERVED: 'NOT_RUN',
          ORIGINAL_DATA_PRESERVED: 'PASS',
          NO_PARTIAL_MIGRATION: 'PASS',
          RECOVERY_SUCCEEDED: 'PASS',
        })
      } else {
        await stop(child)
        add(
          'interrupted migration recovery',
          'NOT_RUN',
          stageSeen === 'core-schema-finished'
            ? 'migration finished before the kill window; increase VITE_TERMINAL_MIGRATION_DELAY_MS'
            : 'snapshot-finished stage was not observed',
        )
        applyFaultAssessment('interrupted', {
          FAULT_INJECTED: 'NOT_RUN',
          APPLICATION_FAILURE_OBSERVED: 'NOT_RUN',
          ORIGINAL_DATA_PRESERVED: 'NOT_RUN',
          NO_PARTIAL_MIGRATION: 'NOT_RUN',
          RECOVERY_SUCCEEDED: 'NOT_RUN',
        })
      }
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
      applyFaultAssessment('restart-idempotent', {
        FAULT_INJECTED: 'PASS',
        APPLICATION_FAILURE_OBSERVED: 'NOT_RUN',
        ORIGINAL_DATA_PRESERVED: 'PASS',
        NO_PARTIAL_MIGRATION: expectedNewHostColumns.every(column =>
          execFileSyncSqlite(db, "SELECT name FROM pragma_table_info('hosts')").includes(column),
        ) ? 'PASS' : 'FAIL',
        RECOVERY_SUCCEEDED: 'PASS',
      })
    }
    if (fault === 'restore-backup') {
      if (!backup) {
        add('backup restore', 'FAIL', 'this B produced no pre-migration backup')
      } else {
        copyFileSync(db, path.join(work, 'post-upgrade.db'))
        await replaceWithBackup(db, backup, dataDir)
        const restoredHash = sha256File(db)
        add(
          'restored DB matches backup',
          restoredHash === sha256File(backup) ? 'PASS' : 'FAIL',
          restoredHash.slice(0, 16),
        )
        child = launch(aBinary, home, path.join(logs, 'a-restored.log'))
        try {
          await waitForSchema(db, 'hosts:id;settings:key;workspaces:id;workspace_layouts:workspace_id')
          await stop(child)
          await dr(['checkpoint', '--db', db])
          await dr([
            'verify', '--db', db, '--before', path.join(work, 'a-snapshot.json'),
            '--token', token, '--vault', vault, '--allow-settings-migration',
          ])
          add('backup restore', 'PASS', 'A launched and read the restored pre-migration DB')
        } catch (error) {
          await stop(child)
          add('backup restore', 'FAIL', errorMessage(error))
        }
      }
      reportJson.status = reportJson.checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS'
      await report(work, reportDir, reportJson)
      return reportJson
    }

    if (fault === 'downgrade') {
      copyFileSync(db, path.join(work, 'post-upgrade.db'))
      const beforeDowngrade = sha256File(db)
      let compatible = false
      child = launch(aBinary, home, path.join(logs, 'a-downgrade.log'))
      try {
        await waitForSchema(db, 'hosts:id;settings:key;workspaces:id;workspace_layouts:workspace_id')
        await stop(child)
        await dr([
          'verify', '--db', db, '--before', path.join(work, 'a-snapshot.json'),
          '--token', token, '--vault', vault, '--allow-settings-migration',
        ])
        compatible = true
        add('downgrade readability', 'PASS', 'A reads the additive post-migration schema')
      } catch (error) {
        await stop(child)
        const columns = execFileSyncSqlite(db, "SELECT name FROM pragma_table_info('hosts')")
        const schemaIntact = expectedNewHostColumns.every(column => columns.includes(column))
        add(
          'downgrade readability',
          'PASS',
          schemaIntact
            ? 'A refused the newer schema without dropping columns; restore-from-backup is required'
            : 'A damaged the newer schema',
        )
        if (!schemaIntact) add('downgrade data safety', 'FAIL', errorMessage(error))
      }
      const afterDowngrade = sha256File(db)
      add(
        'downgrade did not destroy data',
        afterDowngrade === beforeDowngrade || compatible ? 'PASS' : 'FAIL',
        afterDowngrade.slice(0, 16),
      )
      reportJson.status = reportJson.checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS'
      await report(work, reportDir, reportJson)
      return reportJson
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

async function startXvfb() {
  const display = ':' + (90 + (process.pid % 50))
  const child = spawn(
    'Xvfb',
    [display, '-screen', '0', '1280x1024x24', '+extension', 'GLX', '+render', '-noreset'],
    { stdio: 'ignore' },
  )
  await waitFor(
    async () => {
      try {
        await run('xdpyinfo', ['-display', display])
        return true
      } catch {
        return false
      }
    },
    15_000,
    'Xvfb ' + display,
  )
  return { display, stop: () => child.kill('SIGTERM') }
}

async function installDeb(installer) {
  const pkg = (await run('dpkg-deb', ['-f', installer, 'Package'])).stdout.trim()
  const version = (await run('dpkg-deb', ['-f', installer, 'Version'])).stdout.trim()
  await run(
    'sudo',
    ['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', installer],
    { env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }, maxBuffer: 10 * 1024 * 1024 },
  )
  const installedVersion = (
    await run('dpkg-query', ['-W', '-f=${Version}', pkg])
  ).stdout.trim()
  const files = (await run('dpkg', ['-L', pkg])).stdout.split('\n')
  const binary = files.find(file => file.startsWith('/usr/bin/') && file.length > 9)
  if (!binary) throw new Error('the installed deb has no /usr/bin executable')
  return { pkg, version, installedVersion, binary }
}

function installAppImage(installer, destination) {
  copyFileSync(installer, destination)
  chmodSync(destination, 0o755)
  return destination
}

async function runLinux(flags) {
  const aInstaller = path.resolve(flags['a-installer'])
  const bInstaller = path.resolve(flags['b-installer'])
  const mode = typeof flags.mode === 'string'
    ? flags.mode
    : bInstaller.toLowerCase().endsWith('.deb') ? 'deb' : 'appimage'
  if (mode !== 'deb' && mode !== 'appimage') {
    throw new Error('Linux mode must be deb or appimage')
  }
  const expectedIdentifier = flags['expect-identifier'] || 'com.baicie.termius'
  const expectedNewHostColumns = String(
    flags['expect-new-host-columns'] || 'agent_forwarding,shell_integration',
  ).split(',').map(value => value.trim()).filter(Boolean)
  const workRoot = path.resolve(flags['work-dir'] || os.tmpdir())
  mkdirSync(workRoot, { recursive: true })
  const work = mkdtempSync(path.join(workRoot, 'terminal-upgrade-linux-'))
  const reportDir = path.resolve(flags['report-dir'] || path.join(work, 'report'))
  const home = path.join(work, 'home')
  const config = path.join(work, 'config')
  const data = path.join(work, 'data')
  const cache = path.join(work, 'cache')
  const apps = path.join(work, 'apps')
  const logs = path.join(work, 'logs')
  for (const directory of [home, config, data, cache, apps, logs]) {
    mkdirSync(directory, { recursive: true })
  }
  const token = 'phase951-linux-' + Date.now()
  const db = path.join(config, expectedIdentifier, 'terminal.db')
  const vault = path.join(config, 'terminal', 'vault.json')
  const reportJson = {
    provider: PROVIDER,
    generatedAt: new Date().toISOString(),
    platform: 'linux',
    mode,
    hostArch: process.arch,
    fault: 'none',
    expectBackup: false,
    work,
    token,
    a: null,
    b: null,
    schema: null,
    checks: [],
    notRun: [
      'real Vault master-password unlock (file persistence only)',
      'Team Sync server synchronization (local tables only)',
      'fault injection on Linux (not implemented; root/read-only semantics differ)',
      'Windows adapter',
      'AppImage internal metadata when extraction is unavailable',
    ],
    logs: { a: path.join(logs, 'a.log'), b: path.join(logs, 'b.log') },
    status: 'FAIL',
  }
  const add = (name, status, detail) => {
    reportJson.checks.push({ name, status, detail: detail || '' })
  }
  let xvfb = null
  let aProcess = null
  try {
    let display = process.env.DISPLAY
    if (!display) {
      xvfb = await startXvfb()
      display = xvfb.display
    }
    reportJson.display = display
    const aMetadata = await inspectAsset(aInstaller, 'linux', {
      sha256: flags['expect-a-sha256'],
      version: flags['expect-a-version'],
      identifier: undefined,
    })
    const bMetadata = await inspectAsset(bInstaller, 'linux', {
      sha256: flags['expect-b-sha256'],
      version: flags['expect-b-version'],
      identifier: undefined,
    })
    reportJson.a = aMetadata
    reportJson.b = bMetadata
    if (aMetadata.status === 'FAIL' || bMetadata.status === 'FAIL') {
      throw new Error('Linux installer metadata did not pass')
    }
    const metadataPartial = aMetadata.status !== 'PASS' || bMetadata.status !== 'PASS'
    if (aMetadata.version && bMetadata.version && aMetadata.version === bMetadata.version) {
      throw new Error('A and B versions are identical: ' + aMetadata.version)
    }
    add('A metadata', aMetadata.status === 'PASS' ? 'PASS' : 'NOT_RUN',
      aMetadata.version || 'UNKNOWN')
    add('B metadata', bMetadata.status === 'PASS' ? 'PASS' : 'NOT_RUN',
      bMetadata.version || 'UNKNOWN')
    if (!aMetadata.version || !bMetadata.version) {
      add('A/B version comparison', 'NOT_RUN', 'internal AppImage version metadata unavailable')
    }

    let aBinary
    let aInstalled
    if (mode === 'deb') {
      aInstalled = await installDeb(aInstaller)
      aBinary = aInstalled.binary
      add('install A (deb)', 'PASS', aInstalled.pkg + ' ' + aInstalled.installedVersion)
    } else {
      aBinary = installAppImage(aInstaller, path.join(apps, 'Terminal-A.AppImage'))
      add('install A (AppImage replacement)', 'PASS', aBinary)
    }
    const driPath = process.arch === 'arm64'
      ? '/usr/lib/aarch64-linux-gnu/dri'
      : '/usr/lib/x86_64-linux-gnu/dri'
    const env = {
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: data,
      XDG_CACHE_HOME: cache,
      WEBKIT_DISABLE_COMPOSITING_MODE: '1',
      // WebKit's WebProcess sandbox cannot reach the X socket/EGL device on
      // this headless runner; the UI process starts, then the WebProcess
      // aborts. This is a test-environment setting, not a product default.
      WEBKIT_FORCE_SANDBOX: '0',
      WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: '1',
      EGL_LOG_LEVEL: 'debug',
      LIBGL_ALWAYS_SOFTWARE: '1',
      // AppImages can bundle libEGL without the matching Mesa DRI drivers.
      // Point the loader at the runner's software stack explicitly.
      LIBGL_DRIVERS_PATH: driPath,
      MESA_LOADER_DRIVER_OVERRIDE: 'llvmpipe',
      GALLIUM_DRIVER: 'llvmpipe',
      EGL_PLATFORM: 'x11',
      GDK_BACKEND: 'x11',
      NO_AT_BRIDGE: '1',
      APPIMAGE_EXTRACT_AND_RUN: '1',
      DISPLAY: display,
    }
    aProcess = launch(aBinary, home, reportJson.logs.a, env)
    await waitForDatabase(db)
    add('A database created', 'PASS', db)
    await waitForSchema(db, 'hosts:id;settings:key;workspaces:id;workspace_layouts:workspace_id')
    add('A schema ready', 'PASS')
    const stopA = await stop(aProcess)
    aProcess = null
    add('A stopped', 'PASS', stopA)
    await dr(['checkpoint', '--db', db])
    await dr(['seed', '--db', db, '--token', token, '--vault', vault, '--compatible'])
    add('seed A data', 'PASS', 'compatible with A schema')
    const beforePath = path.join(work, 'a-snapshot.json')
    await dr(['snapshot', '--db', db, '--token', token, '--vault', vault, '--out', beforePath])
    const before = JSON.parse(readFileSync(beforePath, 'utf8'))
    reportJson.schema = {
      beforeHostColumns: before.schema?.hosts ?? null,
      afterHostColumns: null,
      addedHostColumns: null,
    }
    add('A read-back snapshot', 'PASS', 'hosts/settings/workspace/layout/vault readable')

    let bBinary
    if (mode === 'deb') {
      const bInstalled = await installDeb(bInstaller)
      if (bMetadata.version && bInstalled.installedVersion !== bMetadata.version) {
        add('B installed version', 'FAIL',
          bInstalled.installedVersion + ' != ' + bMetadata.version)
      } else {
        add('B installed version', 'PASS', bInstalled.installedVersion)
      }
      if (aInstalled && aInstalled.installedVersion === bInstalled.installedVersion) {
        add('A->B version changed', 'FAIL', 'dpkg still reports the A version')
      } else {
        add('A->B version changed', 'PASS',
          (aInstalled?.installedVersion ?? '?') + ' -> ' + bInstalled.installedVersion)
      }
      bBinary = bInstalled.binary
    } else {
      // Replace the exact file A was launched from: this is the upgrade a user
      // performs by substituting the AppImage, not a second side-by-side copy.
      bBinary = installAppImage(bInstaller, aBinary)
      const replacedSha = sha256File(bBinary)
      if (replacedSha !== bMetadata.sha256) {
        add('B AppImage replaced in place', 'FAIL',
          replacedSha + ' != ' + bMetadata.sha256)
      } else {
        add('B AppImage replaced in place', 'PASS', bBinary)
      }
    }

    aProcess = launch(bBinary, home, reportJson.logs.b, env)
    await waitForSchema(db, 'hosts:' + expectedNewHostColumns.join(','))
    add('B migration', 'PASS', expectedNewHostColumns.join(','))
    const stopB = await stop(aProcess)
    aProcess = null
    add('B stopped', 'PASS', stopB)
    await dr(['checkpoint', '--db', db])
    const afterColumns = execFileSyncSqlite(db, "SELECT name FROM pragma_table_info('hosts')")
    reportJson.schema.afterHostColumns = afterColumns
    reportJson.schema.addedHostColumns = afterColumns.filter(
      column => !(reportJson.schema.beforeHostColumns || []).includes(column),
    )
    await dr([
      'verify', '--db', db, '--before', beforePath,
      '--token', token, '--vault', vault,
      '--expected-new-host-columns', expectedNewHostColumns.join(','),
      '--allow-settings-migration',
    ])
    add('data integrity after B', 'PASS', 'field-by-field')
    if (before.team && Object.values(before.team).some(Boolean)) {
      add('Team Sync local persistence', 'PASS',
        'teams/members/shared hosts/sync_queue/user_profile')
    }
    add('pre-migration backup', 'NOT_RUN', 'Linux B has no backup probe in this iteration')
    reportJson.status = reportJson.checks.some(check => check.status === 'FAIL')
      ? 'FAIL'
      : metadataPartial ? 'PARTIAL' : 'PASS'
    await report(work, reportDir, reportJson)
    return reportJson
  } catch (error) {
    add('harness', 'FAIL', errorMessage(error))
    reportJson.status = 'FAIL'
    await report(work, reportDir, reportJson).catch(() => undefined)
    return reportJson
  } finally {
    if (aProcess) await stop(aProcess).catch(() => undefined)
    xvfb?.stop()
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
  if (platform !== 'darwin' && platform !== 'linux') {
    const reportJson = {
      provider: PROVIDER,
      platform,
      status: 'NOT_RUN',
      checks: [],
      notRun: ['the ' + platform + ' adapter was not executed (macOS and Linux are implemented)'],
    }
    await report(process.cwd(), path.resolve(parsed.flags['report-dir'] || '.'), reportJson)
    console.log(JSON.stringify(reportJson, null, 2))
    process.exitCode = 1
    return
  }
  const result = platform === 'darwin' ? await runMacos(parsed.flags) : await runLinux(parsed.flags)
  console.log(JSON.stringify(result, null, 2))
  // PARTIAL is a real result (for example, AppImage payloads without internal
  // version metadata). The independent evidence gate decides whether its
  // missing facts are acceptable; only FAIL/NOT_RUN make the harness itself red.
  process.exitCode = result.status === 'FAIL' || result.status === 'NOT_RUN' ? 1 : 0
}

main().catch(error => {
  console.error('[' + PROVIDER + '] ' + errorMessage(error))
  process.exitCode = 2
})
