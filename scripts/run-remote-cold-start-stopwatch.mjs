import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { runColdStartStopwatch } from './run-cold-start-stopwatch.mjs'
import { startTerminalSmokeSshd } from './terminal-smoke-sshd.mjs'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MARKER = 'REMOTE_COLD_MARKER'
const DEFAULT_PROMPT_MARKER = 'REMOTE_PROMPT_MARKER'
const APP_BUNDLE_ID = 'com.baicie.termius'
const SUPPORTED_FIXTURE_SHELLS = ['sh', 'bash', 'zsh']
const SUPPORTED_SHELL_INTEGRATION = ['off', 'bash', 'zsh']

export function terminalSmokeTempDirectory({
  platform = process.platform,
  environment = process.env,
  homeDirectory = os.homedir(),
  systemTempDirectory = os.tmpdir(),
} = {}) {
  return (
    environment.TERMINAL_SMOKE_TMP ||
    (platform === 'linux' ? homeDirectory : systemTempDirectory)
  )
}

const defaultDependencies = {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  runStopwatch: runColdStartStopwatch,
  spawn,
  startSshd: startTerminalSmokeSshd,
  writeFile,
  tempDirectory: terminalSmokeTempDirectory(),
  platform: process.platform,
}

function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`)
  }
  return value
}

function sqlText(value) {
  return String(value).replaceAll("'", "''")
}

export function appConfigDirectory(home, platform, environment = {}) {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_BUNDLE_ID)
  }
  if (platform === 'linux') {
    return path.join(
      environment.XDG_CONFIG_HOME ?? path.join(home, '.config'),
      APP_BUNDLE_ID,
    )
  }
  if (platform === 'win32') {
    return path.join(
      environment.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      APP_BUNDLE_ID,
    )
  }
  throw new Error(`unsupported remote cold-start platform: ${platform}`)
}

export function createDatabaseSql({
  fixture,
  workspaceId,
  tabId,
  hostId,
  markerCommand,
  shellIntegration = 'off',
}) {
  const now = Date.now()
  const layout = JSON.stringify({
    workspaceId,
    tabs: [{ id: tabId, label: 'Remote Cold', type: 'remote', hostId }],
    splitGroups: [],
    activeTabId: tabId,
    sidebarVisible: true,
  })
  const host = [
    hostId,
    'Remote Cold',
    fixture.host,
    fixture.port,
    fixture.username,
    'key',
    fixture.privateKey,
    markerCommand,
  ].map(sqlText)
  return [
    'PRAGMA journal_mode=WAL;',
    "CREATE TABLE hosts (id TEXT PRIMARY KEY,name TEXT NOT NULL,hostname TEXT NOT NULL,port INTEGER,username TEXT NOT NULL,auth_type TEXT,password TEXT,private_key TEXT,certificate TEXT,group_id TEXT,is_favorite INTEGER,color TEXT,tags TEXT,port_forwards TEXT,startup_command TEXT,environment TEXT,jump_host_id TEXT,jump_host_auth_type TEXT,agent_forwarding INTEGER,shell_integration TEXT DEFAULT 'off',created_at INTEGER,updated_at INTEGER);",
    'CREATE TABLE workspaces (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,icon TEXT,color TEXT,"order" INTEGER,is_active INTEGER,created_at INTEGER,updated_at INTEGER);',
    'CREATE TABLE workspace_layouts (workspace_id TEXT PRIMARY KEY,layout_data TEXT);',
    `INSERT INTO hosts (id,name,hostname,port,username,auth_type,private_key,startup_command,shell_integration,is_favorite,port_forwards,created_at,updated_at) VALUES ('${host[0]}','${host[1]}','${host[2]}',${host[3]},'${host[4]}','${host[5]}','${host[6]}','${host[7]}','${sqlText(shellIntegration)}',0,'[]',${now},${now});`,
    `INSERT INTO workspaces (id,name,"order",is_active,created_at,updated_at) VALUES ('${sqlText(workspaceId)}','Remote Cold',0,1,${now},${now});`,
    `INSERT INTO workspace_layouts (workspace_id,layout_data) VALUES ('${sqlText(workspaceId)}','${sqlText(layout)}');`,
  ].join('\n')
}

async function createSqliteDatabase(home, options, dependencies) {
  const appData = appConfigDirectory(
    home,
    dependencies.platform,
    dependencies.environment ?? process.env,
  )
  await dependencies.mkdir(appData, { recursive: true })
  const databasePath = path.join(appData, 'terminal.db')
  const sql = createDatabaseSql(options)
  const child = dependencies.spawn('/usr/bin/sqlite3', [databasePath], {
    shell: false,
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  child.stdin.end(sql)
  await new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => (stderr += chunk))
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`sqlite3 exited with code ${String(code)}: ${stderr.trim()}`))
    })
  })
  return databasePath
}

export async function runRemoteColdStartStopwatch({
  appPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  shell = 'bash',
  shellIntegration = shell,
  dependencies: overrides = {},
} = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (dependencies.platform !== 'darwin' && dependencies.platform !== 'linux') {
    throw new Error('remote cold-start stopwatch is supported on macOS and Linux only')
  }
  if (!SUPPORTED_FIXTURE_SHELLS.includes(shell)) {
    throw new Error(
      `unsupported remote cold-start fixture shell: ${shell}; expected ${SUPPORTED_FIXTURE_SHELLS.join('/')}`,
    )
  }
  if (!SUPPORTED_SHELL_INTEGRATION.includes(shellIntegration)) {
    throw new Error(
      `unsupported remote shell integration: ${shellIntegration}; expected ${SUPPORTED_SHELL_INTEGRATION.join('/')}`,
    )
  }
  const executable = absolute(appPath, 'remote cold-start stopwatch app path')
  const home = await dependencies.mkdtemp(
    path.join(dependencies.tempDirectory, 'terminal-remote-cold-home-'),
  )
  const runDirectory = await dependencies.mkdtemp(
    path.join(dependencies.tempDirectory, 'terminal-remote-cold-fixture-'),
  )
  let fixture
  try {
    fixture = await dependencies.startSshd({
      runDirectory,
      shell,
      emitPromptMarker: false,
      dependencies,
    })
    const markerPath = path.join(fixture.homePath, DEFAULT_MARKER)
    const promptMarkerPath = path.join(fixture.homePath, DEFAULT_PROMPT_MARKER)
    const quoteShellPath = value => `'${value.replaceAll("'", `'"'"'`)}'`
    const markerCommand =
      `printf %s ${DEFAULT_MARKER} > ${quoteShellPath(markerPath)}; ` +
      `cd ${quoteShellPath(fixture.homePath)}`
    const promptCommand = `printf '%s\\n' ${DEFAULT_PROMPT_MARKER}; false`
    const sshDirectory = path.join(home, '.ssh')
    await dependencies.mkdir(sshDirectory, { recursive: true, mode: 0o700 })
    await dependencies.writeFile(
      path.join(sshDirectory, 'known_hosts'),
      await dependencies.readFile(fixture.knownHostsPath, 'utf8'),
      { encoding: 'utf8', mode: 0o600 },
    )
    await createSqliteDatabase(
      home,
      {
        fixture,
        workspaceId: 'remote-cold-workspace',
        tabId: 'remote-cold-tab',
        hostId: 'remote-cold-host',
        markerCommand,
        shellIntegration,
      },
      dependencies,
    )
    const result = await dependencies.runStopwatch({
      appPath: executable,
      timeoutMs,
      axProbe: 'none',
      readinessMode: 'remote',
      homeDirectory: home,
      markerPath,
      markerContent: DEFAULT_MARKER,
      markerChecks: [{ path: promptMarkerPath, content: DEFAULT_PROMPT_MARKER }],
      environment: {
        SSH_AUTH_SOCK: '',
        ...(dependencies.platform === 'linux'
          ? { XDG_CONFIG_HOME: path.join(home, '.config') }
          : {}),
        TERMINAL_REMOTE_PROMPT_PROBE_PATH: promptMarkerPath,
        TERMINAL_REMOTE_PROMPT_PROBE_MARKER: DEFAULT_PROMPT_MARKER,
        TERMINAL_REMOTE_PROMPT_PROBE_COMMAND: promptCommand,
        TERMINAL_REMOTE_PROMPT_PROBE_EXPECTED_CWD: fixture.homePath,
        TERMINAL_REMOTE_PROMPT_PROBE_EXPECTED_EXIT_CODE: '1',
      },
      dependencies: {
        ...dependencies,
        tempDirectory: dependencies.tempDirectory,
      },
    })
    return {
      ...result,
      fixture: {
        host: fixture.host,
        port: fixture.port,
        username: fixture.username,
      },
      marker: DEFAULT_MARKER,
      promptMarker: DEFAULT_PROMPT_MARKER,
      promptMarkerPath,
      shell,
      shellIntegration,
      expectedCwd: fixture.homePath,
      expectedExitCode: 1,
    }
  } finally {
    await fixture?.stop().catch(() => {})
    await dependencies.rm(runDirectory, { recursive: true, force: true })
    await dependencies.rm(home, { recursive: true, force: true })
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const argv = process.argv.slice(2)
  const appPath = argv.includes('--app-path')
    ? argv[argv.indexOf('--app-path') + 1]
    : undefined
  const timeout = argv.includes('--timeout-ms')
    ? Number(argv[argv.indexOf('--timeout-ms') + 1])
    : DEFAULT_TIMEOUT_MS
  const shell = argv.includes('--shell')
    ? argv[argv.indexOf('--shell') + 1]
    : 'bash'
  const shellIntegration = argv.includes('--shell-integration')
    ? argv[argv.indexOf('--shell-integration') + 1]
    : shell
  runRemoteColdStartStopwatch({
    appPath,
    timeoutMs: timeout,
    shell,
    shellIntegration,
  })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
