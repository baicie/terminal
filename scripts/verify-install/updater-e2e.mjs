#!/usr/bin/env node
// Signed updater runtime E2E.
//
// Two real builds with a throwaway minisign key, a loopback HTTP endpoint and
// the packaged macOS app: A is installed from its .app bundle, checks, downloads
// the signed B archive, verifies it, installs it, restarts, and comes back as B
// with its SQLite data intact. Every negative case is a distinct server mode,
// so the refusal is attributed to the artefact the updater was actually served
// rather than to a shared failure.
//
// The keys are generated in a temporary directory and never written to the
// repository, an artifact, or a release. The production pubkey in
// tauri.conf.json is untouched; the test key reaches the build only through
// --config.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(import.meta.dirname, '../..')
// Tauri's updater refuses an install path that crosses a symlink. On macOS
// /tmp (and /var) are symlinks, so the app and its work directory have to live
// under a real directory: the checkout, or RUNNER_TEMP in CI.
const STATE = process.env.UPDATER_E2E_WORK_DIR
  ? path.resolve(process.env.UPDATER_E2E_WORK_DIR)
  : path.join(ROOT, 'updater-e2e-work')
const REPORT_PATH = process.env.UPDATER_E2E_REPORT
  ?? path.join(ROOT, 'updater-e2e-report.json')
const LOG_DIR = path.join(STATE, 'logs')
const INSTALL_DIR = path.join(STATE, 'installed')
const APP_A = path.join(STATE, 'app-a')
const A_VERSION = '0.0.1-updater.1'
const B_VERSION = '0.0.1-updater.2'
const DOWNGRADE_VERSION = '0.0.1-updater.0'
// Test builds carry their own identifier: it keeps the E2E away from the
// production app's data directory and its single-instance socket, and it
// survives the macOS LaunchServices restart, which drops the harness HOME.
// The production identifier in tauri.conf.json is not touched.
const IDENTIFIER = 'com.baicie.termius.updater-e2e'

const cases = []
const failures = []

if (process.env.CI !== 'true' && process.env.TERMINAL_UPDATER_E2E_ALLOW_LOCAL !== '1') {
  console.error(
    'updater-e2e installs and restarts a real app bundle: run it in CI, or set '
    + 'TERMINAL_UPDATER_E2E_ALLOW_LOCAL=1 and UPDATER_E2E_WORK_DIR to an isolated directory.',
  )
  process.exit(2)
}
// A relaunched app from an earlier run is a real process holding the
// single-instance lock: every later launch would exit 0 without running setup.
// Only processes started from this work directory are touched.
try {
  execFileSync('pkill', ['-f', path.join(STATE, 'installed')])
} catch {
  // nothing matched, which is the normal case on a clean machine
}
mkdirSync(LOG_DIR, { recursive: true })
mkdirSync(INSTALL_DIR, { recursive: true })

function logPath(name) {
  return path.join(LOG_DIR, `${name}.log`)
}

function runChecked(name, command, args, options = {}) {
  const file = logPath(name)
  const fd = openSync(file, 'w')
  try {
    execFileSync(command, args, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', fd, fd],
      timeout: options.timeoutMs ?? 20 * 60 * 1000,
    })
  } catch (error) {
    const tail = readFileSync(file, 'utf8').slice(-4000)
    throw new Error(`${name} failed: ${error.message}\n${tail}`)
  } finally {
    closeSync(fd)
  }
  return file
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function platformKey() {
  return process.arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86_64'
}

function otherPlatformKey() {
  return process.arch === 'arm64' ? 'darwin-x86_64' : 'darwin-aarch64'
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function appBundle(dir) {
  const entries = readdirSync(dir).filter(name => name.endsWith('.app'))
  if (entries.length !== 1) {
    throw new Error(`expected one .app in ${dir}, found ${entries.join(', ') || 'none'}`)
  }
  return path.join(dir, entries[0])
}

function executable(bundle) {
  const macos = path.join(bundle, 'Contents/MacOS')
  const names = readdirSync(macos)
  if (names.length !== 1) throw new Error(`expected one executable in ${macos}`)
  return path.join(macos, names[0])
}

function bundleVersion(bundle) {
  try {
    return execFileSync(
      'plutil',
      ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(bundle, 'Contents/Info.plist')],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    return null
  }
}

function installedBundle() {
  return appBundle(INSTALL_DIR)
}

function installedVersion() {
  return bundleVersion(installedBundle())
}

/** Build one version. The key and endpoint are injected; nothing is committed. */
function buildVersion(name, version, pubkey, endpoint, artifacts) {
  const config = {
    version,
    identifier: IDENTIFIER,
    plugins: {
      updater: {
        pubkey,
        endpoints: [endpoint],
        dangerousInsecureTransportProtocol: true,
      },
    },
    ...(artifacts ? { bundle: { createUpdaterArtifacts: true } } : {}),
  }
  const env = {
    CI: 'true',
    // Compiled into the test binary: the only channel that survives a macOS
    // LaunchServices restart, which drops the harness environment.
    TERMINAL_UPDATER_PROBE_BOOT_PATH: path.join(STATE, 'boot.log'),
  }
  if (artifacts) {
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(path.join(STATE, 'key'), 'utf8')
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
  }
  runChecked(name, 'pnpm', [
    'tauri',
    'build',
    '--features',
    'smoke-updater',
    '--bundles',
    'app',
    '--config',
    JSON.stringify(config),
  ], { env, timeoutMs: 25 * 60 * 1000 })
}

function launchApp(env) {
  const child = spawn(executable(installedBundle()), [], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += String(chunk) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  return {
    child,
    output: () => output,
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        sleep(5000),
      ])
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

function classify(error) {
  const text = String(error ?? '')
  if (/signature|minisign|verif|trusted comment/i.test(text)) return 'signature'
  if (/fallback platforms|was not found|were not found|Unsupported application architecture/i.test(text)) {
    return 'platform'
  }
  if (/fetch|network|404|not found|status code|connection|dns|request/i.test(text)) return 'network'
  return 'other'
}

async function runCase(name, mode, options = {}) {
  state.mode = mode
  const resultPath = path.join(STATE, `result-${name}.json`)
  const relaunchPath = `${resultPath}.relaunch`
  rmSync(resultPath, { force: true })
  rmSync(relaunchPath, { force: true })
  const app = launchApp({
    TERMINAL_UPDATER_PROBE_ACTION: options.action ?? 'install',
    TERMINAL_UPDATER_PROBE_RESULT: resultPath,
    TERMINAL_UPDATER_PROBE_RESTART: options.restart ? '1' : '0',
    TERMINAL_UPDATER_PROBE_EXIT: options.restart ? '0' : '1',
  })
  const record = {
    name,
    mode,
    expected: options.expect ?? 'installed',
    status: 'timeout',
    errorClass: null,
    currentVersion: null,
    availableVersion: null,
    installedVersionBefore: options.versionBefore ?? installedVersion(),
    installedVersionAfter: null,
    relaunchVersion: null,
  }
  try {
    await waitFor(() => existsSync(resultPath), options.timeoutMs ?? 120000, `${name} result`)
    Object.assign(record, readJson(resultPath))
    if (options.restart && existsSync(relaunchPath)) {
      record.relaunchVersion = readJson(relaunchPath).currentVersion
    }
  } catch (error) {
    record.harnessError = String(error)
  } finally {
    if (options.restart) {
      // The update is installed; what remains is proving the app came back.
      // A macOS restart goes through LaunchServices, so the new process has no
      // harness environment at all. The operating system still reports it: a
      // PID other than the one we launched, running the installed bundle.
      try {
        await waitFor(
          () => relaunchedPids(app.child.pid).length > 0,
          120000,
          `${name} relaunched process`,
        )
        record.relaunchPid = relaunchedPids(app.child.pid)[0]
        record.relaunchVersion = bundleVersion(installedBundle())
      } catch (error) {
        record.harnessError = String(error)
      }
    }
    await app.stop()
    // The relaunched process is not our child; stop it explicitly so it does
    // not keep the test identifier's instance lock for the next run.
    try {
      execFileSync('pkill', ['-f', executable(installedBundle())])
    } catch {
      // nothing left to stop
    }
  }
  record.installedVersionAfter = installedVersion()
  record.log = app.output().slice(-4000)
  cases.push(record)
  return record
}

/**
 * The data-preservation witness needs the app's own database, which the
 * frontend creates after the window boots. This launch therefore has to stay
 * alive until that file appears; the probe itself only proves the check path.
 */
async function runPrepare(resultPath, database) {
  state.mode = 'valid'
  rmSync(resultPath, { force: true })
  const app = launchApp({
    TERMINAL_UPDATER_PROBE_ACTION: 'check',
    TERMINAL_UPDATER_PROBE_RESULT: resultPath,
  })
  const record = {
    name: 'prepare',
    mode: 'valid',
    expected: 'available',
    status: 'timeout',
    installedVersionBefore: installedVersion(),
  }
  try {
    await waitFor(() => existsSync(resultPath), 60000, 'prepare result')
    Object.assign(record, readJson(resultPath))
    await waitFor(() => existsSync(database), 90000, 'the app database')
  } catch (error) {
    record.harnessError = String(error)
  } finally {
    await app.stop()
  }
  record.installedVersionAfter = installedVersion()
  record.log = app.output().slice(-4000)
  cases.push(record)
  return record
}

/** PIDs running the installed bundle, other than the process we launched. */
function relaunchedPids(originalPid) {
  try {
    return execFileSync('pgrep', ['-f', executable(installedBundle())], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map(value => Number(value))
      .filter(pid => Number.isInteger(pid) && pid > 0 && pid !== originalPid)
  } catch {
    return []
  }
}

const state = { mode: 'valid' }
let payload = null
let signature = null
let server = null

function serveJson(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function manifestFor(mode) {
  const base = `http://127.0.0.1:${server.address().port}`
  const url = mode === 'missing-artifact'
    ? `${base}/missing.tar.gz`
    : `${base}/payload.tar.gz`
  const version = mode === 'downgrade' ? DOWNGRADE_VERSION : B_VERSION
  const signatureValue = mode === 'missing-signature'
    ? ''
    : mode === 'wrong-signature' ? flippedSignature() : signature
  const key = mode === 'wrong-platform' ? otherPlatformKey() : platformKey()
  return {
    version,
    notes: 'updater runtime acceptance (temporary key)',
    pub_date: new Date().toISOString(),
    platforms: { [key]: { signature: signatureValue, url } },
  }
}

function flippedSignature() {
  const bytes = Buffer.from(signature, 'base64')
  bytes[Math.floor(bytes.length / 2)] ^= 0xff
  return bytes.toString('base64')
}

function payloadBytes(mode) {
  if (mode === 'tampered') {
    const copy = Buffer.from(payload)
    copy[Math.floor(copy.length * 0.6)] ^= 0xff
    return copy
  }
  if (mode === 'truncated') return payload.subarray(0, Math.floor(payload.length / 2))
  return payload
}

async function main() {
  const port = await freePort()
  const endpoint = `http://127.0.0.1:${port}/latest.json`

  runChecked('keygen', 'pnpm', [
    'tauri', 'signer', 'generate', '-w', path.join(STATE, 'key'), '-p', '', '--ci', '-f',
  ])
  const pubkey = readFileSync(path.join(STATE, 'key.pub'), 'utf8').trim()

  buildVersion('build-a', A_VERSION, pubkey, endpoint, false)
  cpSync(appBundle(path.join(ROOT, 'src-tauri/target/release/bundle/macos')), path.join(APP_A, 'Termius.app'), { recursive: true })

  buildVersion('build-b', B_VERSION, pubkey, endpoint, true)
  const bundleDir = path.join(ROOT, 'src-tauri/target/release/bundle/macos')
  const tarballName = readdirSync(bundleDir).find(name => name.endsWith('.app.tar.gz'))
  if (tarballName === undefined) throw new Error('the B build produced no updater archive')
  const tarball = path.join(bundleDir, tarballName)
  const signatureFile = `${tarball}.sig`
  if (!existsSync(signatureFile)) throw new Error('the B build produced no .sig')
  payload = readFileSync(tarball)
  signature = readFileSync(signatureFile, 'utf8').trim()

  cpSync(path.join(APP_A, 'Termius.app'), path.join(INSTALL_DIR, 'Termius.app'), { recursive: true })
  const installedBefore = installedVersion()
  if (installedBefore !== A_VERSION) {
    throw new Error(`the installed app is ${installedBefore}, expected ${A_VERSION}`)
  }

  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/latest.json') return serveJson(response, manifestFor(state.mode))
    if (url.pathname === '/payload.tar.gz') {
      response.writeHead(200, { 'content-type': 'application/gzip' })
      return response.end(payloadBytes(state.mode))
    }
    return serveJson(response, { message: 'not found' }, 404)
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

  // A first launch: proves the check path and creates the SQLite database we
  // later use as the data-preservation witness.
  const database = path.join(
    process.env.HOME,
    'Library/Application Support',
    IDENTIFIER,
    'terminal.db',
  )
  const prepare = await runPrepare(path.join(STATE, 'result-prepare.json'), database)
  if (!existsSync(database)) throw new Error('the app never created its database')
  const sqlite = new DatabaseSync(database, { enableDoubleQuotedStringLiterals: true })
  sqlite.exec('CREATE TABLE IF NOT EXISTS updater_probe_marker (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  sqlite.prepare('INSERT OR REPLACE INTO updater_probe_marker (id, value) VALUES (?, ?)').run('marker', 'before-update')
  sqlite.close()

  const negatives = [
    { name: 'downgrade', mode: 'downgrade', expect: 'up_to_date', errorClass: null },
    { name: 'wrong-platform', mode: 'wrong-platform', expect: 'error', errorClass: 'platform' },
    { name: 'missing-artifact', mode: 'missing-artifact', expect: 'error', errorClass: 'network' },
    { name: 'missing-signature', mode: 'missing-signature', expect: 'error', errorClass: 'signature' },
    { name: 'wrong-signature', mode: 'wrong-signature', expect: 'error', errorClass: 'signature' },
    { name: 'tampered', mode: 'tampered', expect: 'error', errorClass: 'signature' },
    { name: 'truncated', mode: 'truncated', expect: 'error', errorClass: 'signature' },
  ]
  for (const entry of negatives) {
    const result = await runCase(entry.name, entry.mode, { expect: entry.expect })
    result.expectedErrorClass = entry.errorClass
    result.errorClass = result.status === 'error' ? classify(result.error) : null
    result.pass = result.status === entry.expect
      && (entry.errorClass === null || result.errorClass === entry.errorClass)
      && result.installedVersionAfter === A_VERSION
    if (!result.pass) failures.push(`${entry.name}: ${result.status} ${result.error ?? ''}`.trim())
  }

  const positive = await runCase('positive', 'valid', { restart: true, expect: 'installed' })
  const databaseAfter = (() => {
    const db = new DatabaseSync(database, { enableDoubleQuotedStringLiterals: true })
    try {
      return db.prepare('SELECT value FROM updater_probe_marker WHERE id = ?').get('marker')?.value ?? null
    } finally {
      db.close()
    }
  })()
  positive.dataMarker = databaseAfter
  positive.pass = positive.status === 'installed'
    && positive.installedVersionAfter === B_VERSION
    && positive.relaunchVersion === B_VERSION
    && databaseAfter === 'before-update'
  if (!positive.pass) failures.push(`positive: ${positive.status} installed=${positive.installedVersionAfter} relaunch=${positive.relaunchVersion} marker=${databaseAfter}`)

  const negativeOk = negatives.every((_, index) => cases.find(entry => entry.name === negatives[index].name)?.pass === true)
  const matrix = {
    UPDATER_RUNTIME_CHECK_VERIFIED: prepare.status === 'available' && prepare.availableVersion === B_VERSION ? 'PASS' : 'FAIL',
    UPDATER_SIGNED_DOWNLOAD_VERIFIED: positive.status === 'installed' ? 'PASS' : 'FAIL',
    UPDATER_INSTALL_RESTART_VERIFIED: positive.relaunchVersion === B_VERSION ? 'PASS' : 'FAIL',
    UPDATER_DATA_PRESERVATION_VERIFIED: databaseAfter === 'before-update' ? 'PASS' : 'FAIL',
    UPDATER_NEGATIVE_MATRIX_VERIFIED: negativeOk ? 'PASS' : 'FAIL',
  }
  const report = {
    kind: 'updater-runtime-e2e',
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    versions: { a: A_VERSION, b: B_VERSION },
    key: { kind: 'temporary-minisign', persisted: false, committed: false },
    artifacts: {
      archive: tarballName,
      archiveSha256: sha256(tarball),
      signatureSha256: sha256(signatureFile),
    },
    cases,
    matrix,
    failures,
    matrixOk: Object.values(matrix).every(value => value === 'PASS'),
  }
  writeJson(REPORT_PATH, report)
  // The test identifier's data directory is ours to remove; the production
  // com.baicie.termius directory is never opened by these builds.
  try {
    rmSync(path.join(process.env.HOME, 'Library/Application Support', IDENTIFIER), {
      recursive: true,
      force: true,
    })
  } catch {
    // a relaunched process may still hold a file; the logs remain
  }
  for (const [key, value] of Object.entries(matrix)) process.stdout.write(`${key}=${value}\n`)
  process.stdout.write(`updater-e2e ${report.matrixOk ? 'passed' : 'failed'}; report: ${REPORT_PATH}\n`)
}

main()
  .then(() => {
    if (server !== null) server.close()
  })
  .catch(async (error) => {
    failures.push(String(error))
    writeJson(REPORT_PATH, {
      kind: 'updater-runtime-e2e',
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      versions: { a: A_VERSION, b: B_VERSION },
      cases,
      matrix: {
        UPDATER_RUNTIME_CHECK_VERIFIED: 'FAIL',
        UPDATER_SIGNED_DOWNLOAD_VERIFIED: 'FAIL',
        UPDATER_INSTALL_RESTART_VERIFIED: 'FAIL',
        UPDATER_DATA_PRESERVATION_VERIFIED: 'FAIL',
        UPDATER_NEGATIVE_MATRIX_VERIFIED: 'FAIL',
      },
      failures,
      matrixOk: false,
    })
    console.error(error)
    if (server !== null) server.close()
  })
  .finally(() => {
    process.exitCode = failures.length === 0 ? 0 : 1
  })
