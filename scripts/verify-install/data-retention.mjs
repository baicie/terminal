#!/usr/bin/env node
/**
 * Phase 8.9 Task 5 - controlled data-retention harness for the packaged app.
 *
 * Every platform script (verify-install-macos.sh, verify-install-linux.sh,
 * verify-install-windows.ps1) drives the same assertions from here, so the three
 * CI jobs cannot drift apart and there is one place to audit what "the data was
 * retained" actually means:
 *
 *   integrity  PRAGMA integrity_check / foreign_key_check on the live app DB
 *   schema     the tables and columns the app itself creates are present
 *   seed       write controlled rows (a host, an app setting, a workspace with
 *              its layout) plus a test vault file. No real credential is used:
 *              the host keeps auth_type 'agent' and both credential columns
 *              NULL, which is asserted later rather than assumed
 *   snapshot   read the seeded rows field by field and dump them to JSON
 *   verify     read the same rows again after the overwrite install and the
 *              relaunch, then compare every asserted field with the snapshot. A
 *              byte-identical file hash is NOT accepted as evidence: it also
 *              holds when the app wrote nothing at all
 *   wait       poll a content condition with a deadline and a probe count,
 *              returning non-zero on timeout instead of sleeping and declaring
 *              success
 *
 * Whatever cannot be established headlessly is printed by the calling platform
 * script as [SKIPPED]/[NOT_RUN] with its reason. Nothing here is swallowed.
 *
 * Usage: node scripts/verify-install/data-retention.mjs <command> [flags]
 * Exit codes: 0 every assertion held, 1 an assertion failed, 2 usage error.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PROVIDER = 'data-retention'
const failures = []
const passes = []

function pass(message) {
  passes.push(message)
  console.log('[PASS] ' + message)
}

function fail(message) {
  failures.push(message)
  console.log('[FAIL] ' + message)
}

function info(message) {
  console.log('[INFO] ' + message)
}

function check(condition, message) {
  if (condition) pass(message)
  else fail(message)
}

function usage(message) {
  console.error('[USAGE] ' + message)
  process.exit(2)
}

function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i += 1
      }
    } else {
      rest.push(token)
    }
  }
  return { command: rest[0], flags: flags }
}

function requireFlag(flags, name) {
  const value = flags[name]
  if (typeof value !== 'string' || value.length === 0) usage('missing --' + name)
  return value
}

function openDb(dbPath) {
  if (!existsSync(dbPath)) {
    console.log('[FAIL] database file does not exist: ' + dbPath)
    console.log('[FAIL] the app never created its database in the isolated data directory')
    process.exit(1)
  }
  const header = readFileSync(dbPath).subarray(0, 15).toString('latin1')
  if (header !== 'SQLite format 3') {
    console.log('[FAIL] ' + dbPath + ' is not a SQLite database (header ' + JSON.stringify(header) + ')')
    process.exit(1)
  }
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout=30000')
  return db
}

function singleValue(db, sql, params) {
  const row = db.prepare(sql).get(...(params || []))
  if (!row) return undefined
  return Object.values(row)[0]
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function fileDigest(path) {
  if (!existsSync(path)) return { path: path, exists: false, bytes: 0, sha256: null }
  const buffer = readFileSync(path)
  return { path: path, exists: true, bytes: statSync(path).size, sha256: sha256(buffer) }
}

/** Canonical JSON (sorted keys) so a digest over the row set stays comparable. */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + canonical(value[key])
    }).join(',') + '}'
  }
  return JSON.stringify(value)
}

// --- the controlled fixture -------------------------------------------------
// Fixed timestamps plus a per-run token: ids are traceable to one CI run and
// nothing below is a credential.

const CREATED_AT = 1750000000000
const VAULT_SALT = Buffer.from('phase89-vault16!').toString('base64')
const HOST_FIELDS = [
  'id', 'name', 'hostname', 'port', 'username', 'auth_type', 'password', 'private_key',
  'certificate', 'group_id', 'is_favorite', 'color', 'tags', 'port_forwards', 'startup_command',
  'environment', 'jump_host_id', 'jump_host_auth_type', 'agent_forwarding', 'shell_integration',
  'created_at', 'updated_at'
]
const SETTINGS_ASSERTED = [
  'theme', 'language', 'fontSize', 'fontFamily', 'terminalTheme', 'terminalThemeDark', 'scrollback'
]

function seededHost(token) {
  return {
    id: 'phase89-host-' + token,
    name: 'phase89-host-' + token,
    hostname: 'phase89.invalid',
    port: 2222,
    username: 'phase89-user',
    auth_type: 'agent',
    password: null,
    private_key: null,
    certificate: null,
    group_id: null,
    is_favorite: 1,
    color: '#336699',
    tags: JSON.stringify(['phase89', token]),
    port_forwards: null,
    startup_command: 'echo phase89-' + token,
    environment: JSON.stringify({ PHASE89: token }),
    jump_host_id: null,
    jump_host_auth_type: null,
    agent_forwarding: 1,
    shell_integration: 'off',
    created_at: CREATED_AT,
    updated_at: CREATED_AT
  }
}

function seededSettings(token) {
  return {
    theme: 'dark',
    language: 'en',
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    terminalTheme: 'one-dark',
    terminalThemeDark: 'one-dark',
    terminalThemeLight: 'solarized-light',
    terminalThemeLightMigrated: false,
    scrollback: 12345,
    phase89Marker: token
  }
}

function seededWorkspace(token) {
  return {
    id: 'phase89-ws-' + token,
    name: 'phase89-workspace-' + token,
    description: 'controlled workspace for retention verification',
    icon: '\u{1F4C1}',
    color: '#123456',
    order: 7,
    is_active: 1,
    created_at: CREATED_AT,
    updated_at: CREATED_AT
  }
}

function seededLayout(token) {
  return {
    tabs: [],
    splitGroups: [],
    activeTabId: null,
    sidebarVisible: false,
    phase89Marker: token
  }
}

// --- commands ---------------------------------------------------------------

function cmdIntegrity(flags) {
  const dbPath = requireFlag(flags, 'db')
  const db = openDb(dbPath)
  const integrity = String(singleValue(db, 'PRAGMA integrity_check'))
  check(integrity === 'ok', 'PRAGMA integrity_check => ' + integrity + ' (' + dbPath + ')')
  info('journal_mode=' + String(singleValue(db, 'PRAGMA journal_mode')))
  const violations = db.prepare('PRAGMA foreign_key_check').all().length
  check(violations === 0, 'PRAGMA foreign_key_check => ' + violations + ' violation(s)')
  db.close()
}

function cmdSchema(flags) {
  const dbPath = requireFlag(flags, 'db')
  const db = openDb(dbPath)
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(function (row) { return row.name })
  info('tables (' + tables.length + '): ' + tables.join(', '))
  const required = ['hosts', 'settings', 'workspaces', 'workspace_layouts', 'ssh_keys', 'known_hosts']
  for (const name of required) check(tables.includes(name), 'the app created table "' + name + '"')
  const columns = db.prepare("SELECT name FROM pragma_table_info('hosts')").all().map(function (row) {
    return row.name
  })
  for (const name of ['id', 'name', 'hostname', 'port', 'username', 'auth_type', 'created_at', 'updated_at']) {
    check(columns.includes(name), 'hosts has column "' + name + '"')
  }
  db.close()
}

function cmdSeed(flags) {
  const dbPath = requireFlag(flags, 'db')
  const token = requireFlag(flags, 'token')
  const vaultPath = typeof flags.vault === 'string' ? flags.vault : null
  const db = openDb(dbPath)
  const host = seededHost(token)
  const workspace = seededWorkspace(token)
  const settingsJson = JSON.stringify(seededSettings(token))
  const layoutJson = JSON.stringify(seededLayout(token))
  const hostColumns = Object.keys(host)
  const wsColumns = ['id', 'name', 'description', 'icon', 'color', '"order"', 'is_active', 'created_at', 'updated_at']
  const wsValues = [
    workspace.id, workspace.name, workspace.description, workspace.icon, workspace.color,
    workspace.order, workspace.is_active, workspace.created_at, workspace.updated_at
  ]
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM hosts WHERE id = ?').run(host.id)
    db.prepare('DELETE FROM workspace_layouts WHERE workspace_id = ?').run(workspace.id)
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspace.id)
    db.prepare(
      'INSERT INTO hosts (' + hostColumns.join(', ') + ') VALUES (' +
        hostColumns.map(function () { return '?' }).join(', ') + ')'
    ).run(...hostColumns.map(function (column) { return host[column] }))
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('app_settings', settingsJson)
    db.prepare(
      'INSERT INTO workspaces (' + wsColumns.join(', ') + ') VALUES (' +
        wsColumns.map(function () { return '?' }).join(', ') + ')'
    ).run(...wsValues)
    db.prepare('INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)').run(
      workspace.id,
      layoutJson
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    fail('seeding the database failed: ' + error.message)
    process.exit(1)
  }
  pass('seeded hosts row id=' + host.id + ' (auth_type=agent, password NULL, private_key NULL)')
  pass('seeded settings row key=app_settings (marker=' + token + ')')
  pass('seeded workspaces row id=' + workspace.id + ' and its workspace_layouts row')

  if (vaultPath) {
    mkdirSync(dirname(vaultPath), { recursive: true })
    try {
      writeFileSync(vaultPath, JSON.stringify({ salt: VAULT_SALT, entries: {} }), { flag: 'wx' })
      pass('seeded test vault file ' + vaultPath + ' (schema-valid, zero entries, no credential)')
    } catch (error) {
      fail('could not write the test vault file ' + vaultPath + ': ' + error.message)
    }
  }
  db.close()
}

function collectRows(db, token) {
  return {
    host: db.prepare('SELECT * FROM hosts WHERE id = ?').get('phase89-host-' + token) || null,
    settings: db.prepare('SELECT key, value FROM settings WHERE key = ?').get('app_settings') || null,
    workspace: db.prepare('SELECT * FROM workspaces WHERE id = ?').get('phase89-ws-' + token) || null,
    layout: db.prepare('SELECT workspace_id, layout_data FROM workspace_layouts WHERE workspace_id = ?')
      .get('phase89-ws-' + token) || null
  }
}

function vaultState(vaultPath) {
  if (!vaultPath) return null
  const digest = fileDigest(vaultPath)
  if (!digest.exists) return Object.assign({}, digest, { parses: false, salt: null, entries: null })
  let parsed = null
  let parses = false
  try {
    parsed = JSON.parse(readFileSync(vaultPath, 'utf8'))
    parses = true
  } catch (error) {
    parses = false
  }
  return Object.assign({}, digest, {
    parses: parses,
    salt: parsed && typeof parsed.salt === 'string' ? parsed.salt : null,
    entries: parsed && parsed.entries && typeof parsed.entries === 'object' ? Object.keys(parsed.entries).length : null
  })
}

function cmdSnapshot(flags) {
  const dbPath = requireFlag(flags, 'db')
  const token = requireFlag(flags, 'token')
  const out = requireFlag(flags, 'out')
  const vaultPath = typeof flags.vault === 'string' ? flags.vault : null
  const db = openDb(dbPath)
  const rows = collectRows(db, token)
  check(Boolean(rows.host), 'snapshot: the seeded hosts row is readable through SQL')
  check(Boolean(rows.settings), 'snapshot: the seeded settings row is readable through SQL')
  check(Boolean(rows.workspace), 'snapshot: the seeded workspaces row is readable through SQL')
  check(Boolean(rows.layout), 'snapshot: the seeded workspace_layouts row is readable through SQL')
  const integrity = String(singleValue(db, 'PRAGMA integrity_check'))
  check(integrity === 'ok', 'snapshot: PRAGMA integrity_check => ' + integrity)
  const snapshot = {
    provider: PROVIDER,
    token: token,
    db: fileDigest(dbPath),
    wal: fileDigest(dbPath + '-wal'),
    integrity: integrity,
    tables: db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(function (row) { return row.name }),
    counts: {
      hosts: singleValue(db, 'SELECT COUNT(*) FROM hosts'),
      workspaces: singleValue(db, 'SELECT COUNT(*) FROM workspaces'),
      settings: singleValue(db, 'SELECT COUNT(*) FROM settings'),
      layouts: singleValue(db, 'SELECT COUNT(*) FROM workspace_layouts')
    },
    host: rows.host,
    settings: {
      key: rows.settings ? rows.settings.key : null,
      value: rows.settings ? rows.settings.value : null,
      parsed: rows.settings ? JSON.parse(rows.settings.value) : {}
    },
    workspace: rows.workspace,
    layout: rows.layout ? { workspace_id: rows.layout.workspace_id, layout_data: rows.layout.layout_data } : null,
    vault: vaultState(vaultPath)
  }
  snapshot.row_digest = sha256(Buffer.from(canonical({
    host: snapshot.host,
    settings: snapshot.settings.value,
    workspace: snapshot.workspace,
    layout: snapshot.layout
  })))
  db.close()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n')
  info('snapshot written to ' + out)
  info('row digest ' + snapshot.row_digest.slice(0, 16) + '... over the seeded rows (canonical JSON, sorted keys)')
  info('database file sha256 ' + String(snapshot.db.sha256).slice(0, 16) + '... bytes=' + snapshot.db.bytes + ' (supplementary only)')
  info('counts hosts=' + snapshot.counts.hosts + ' workspaces=' + snapshot.counts.workspaces +
    ' settings=' + snapshot.counts.settings + ' layouts=' + snapshot.counts.layouts)
}

function compareRow(label, before, after, fields) {
  if (!after) {
    fail(label + ': the row is gone after the install/relaunch cycle')
    return
  }
  for (const field of fields) {
    const expected = before ? before[field] : undefined
    const actual = after[field]
    check(
      canonical(expected === undefined ? null : expected) === canonical(actual === undefined ? null : actual),
      label + '.' + field + ' == ' + JSON.stringify(actual === undefined ? null : actual) +
        ' (expected ' + JSON.stringify(expected === undefined ? null : expected) + ')'
    )
  }
}

function cmdVerify(flags) {
  const dbPath = requireFlag(flags, 'db')
  const beforePath = requireFlag(flags, 'before')
  const token = requireFlag(flags, 'token')
  const vaultPath = typeof flags.vault === 'string' ? flags.vault : null
  const expectAppWrite = flags['expect-app-write'] === true
  if (!existsSync(beforePath)) {
    fail('snapshot file missing: ' + beforePath)
    process.exit(1)
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8'))
  const db = openDb(dbPath)

  const integrity = String(singleValue(db, 'PRAGMA integrity_check'))
  check(integrity === 'ok', 'PRAGMA integrity_check after the cycle => ' + integrity)
  const violations = db.prepare('PRAGMA foreign_key_check').all().length
  check(violations === 0, 'PRAGMA foreign_key_check after the cycle => ' + violations + ' violation(s)')

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(function (row) { return row.name })
  for (const name of before.tables) check(tables.includes(name), 'table "' + name + '" still exists (schema not reset)')

  const rows = collectRows(db, token)
  compareRow('hosts', before.host, rows.host, HOST_FIELDS)
  if (rows.host) {
    check(rows.host.password === null, 'hosts.password is still NULL (no credential was ever stored)')
    check(rows.host.private_key === null, 'hosts.private_key is still NULL (no credential was ever stored)')
  }
  compareRow('workspaces', before.workspace, rows.workspace, [
    'id', 'name', 'description', 'icon', 'color', 'order', 'created_at'
  ])
  if (rows.workspace && before.workspace) {
    info('workspaces.is_active ' + before.workspace.is_active + ' -> ' + rows.workspace.is_active +
      ' (the app owns the active flag; reported, not gated)')
  }

  if (!rows.layout) {
    fail('workspace_layouts: the layout row is gone after the install/relaunch cycle')
  } else {
    const beforeLayout = before.layout ? JSON.parse(before.layout.layout_data) : null
    let actual = null
    let parses = false
    try {
      actual = JSON.parse(rows.layout.layout_data)
      parses = true
    } catch (error) {
      parses = false
    }
    check(parses, 'workspace_layouts.layout_data is still valid JSON')
    if (parses && beforeLayout) {
      check(
        actual.phase89Marker === beforeLayout.phase89Marker,
        'workspace_layouts.layout_data kept the controlled marker ' + JSON.stringify(actual.phase89Marker)
      )
      check(
        actual.sidebarVisible === beforeLayout.sidebarVisible,
        'workspace_layouts.sidebarVisible == ' + JSON.stringify(actual.sidebarVisible)
      )
    }
  }

  if (!rows.settings) {
    fail('settings: the seeded app_settings row is gone after the install/relaunch cycle')
  } else {
    let parsed = null
    try {
      parsed = JSON.parse(rows.settings.value)
    } catch (error) {
      parsed = null
    }
    check(parsed !== null, 'settings.app_settings still parses as JSON')
    if (parsed) {
      const beforeParsed = before.settings.parsed || {}
      for (const field of SETTINGS_ASSERTED) {
        check(
          canonical(parsed[field]) === canonical(beforeParsed[field]),
          'settings.app_settings.' + field + ' == ' + JSON.stringify(parsed[field]) +
            ' (expected ' + JSON.stringify(beforeParsed[field]) + ')'
        )
      }
      check(parsed.phase89Marker === token, 'settings.app_settings.phase89Marker is still ' + token)
      if (expectAppWrite) {
        // The app reads this row at boot (store/app.ts hydrateFromDatabase ->
        // getAppSettings) and rewrites it while terminalThemeLightMigrated is
        // false. That rewrite is a content-dependent side effect: it can only
        // appear if the app really read the row this run seeded, so it is gated.
        check(
          parsed.terminalThemeLightMigrated === true,
          'settings: the app read the seeded row and persisted terminalThemeLightMigrated=true (content-dependent read proof)'
        )
        info('settings.terminalThemeLight ' + JSON.stringify(beforeParsed.terminalThemeLight) + ' -> ' +
          JSON.stringify(parsed.terminalThemeLight) + ' (legacy-default migration; reported, not gated)')
      } else {
        check(
          canonical(parsed.terminalThemeLightMigrated) === canonical(beforeParsed.terminalThemeLightMigrated),
          'settings.app_settings.terminalThemeLightMigrated == ' + JSON.stringify(parsed.terminalThemeLightMigrated)
        )
      }
    }
  }

  const counts = {
    hosts: singleValue(db, 'SELECT COUNT(*) FROM hosts'),
    workspaces: singleValue(db, 'SELECT COUNT(*) FROM workspaces'),
    settings: singleValue(db, 'SELECT COUNT(*) FROM settings'),
    layouts: singleValue(db, 'SELECT COUNT(*) FROM workspace_layouts')
  }
  info('row counts before hosts=' + before.counts.hosts + ' workspaces=' + before.counts.workspaces +
    ' settings=' + before.counts.settings + ' layouts=' + before.counts.layouts)
  info('row counts after  hosts=' + counts.hosts + ' workspaces=' + counts.workspaces +
    ' settings=' + counts.settings + ' layouts=' + counts.layouts)
  check(counts.hosts >= before.counts.hosts, 'hosts: row count did not shrink (the seeded row was not dropped)')
  check(
    counts.workspaces === before.counts.workspaces,
    'workspaces: the app neither dropped our workspace nor created its own default one'
  )

  const afterDigest = sha256(Buffer.from(canonical({
    host: rows.host,
    settings: rows.settings ? rows.settings.value : null,
    workspace: rows.workspace,
    layout: rows.layout
  })))
  info('row digest after ' + afterDigest.slice(0, 16) + '... (before ' + String(before.row_digest).slice(0, 16) + '...)')
  info('that digest is reported for the record only; the field-by-field assertions above are the evidence')

  if (vaultPath) {
    const vault = vaultState(vaultPath)
    check(vault.exists, 'vault file still exists at ' + vaultPath)
    check(vault.parses, 'vault file still parses as the app JSON vault config')
    if (vault.parses) {
      check(vault.salt === VAULT_SALT, 'vault salt field is byte-identical to the seeded value')
      check(vault.entries === 0, 'vault entry count is still 0 (got ' + vault.entries + ')')
    }
    if (before.vault && vault.sha256) {
      info('vault sha256 ' + String(before.vault.sha256).slice(0, 16) + '... -> ' +
        String(vault.sha256).slice(0, 16) + '... (supplementary)')
    }
  }
  db.close()
}

function cmdWait(flags) {
  const dbPath = requireFlag(flags, 'db')
  const mode = typeof flags.mode === 'string' ? flags.mode : 'db-exists'
  if (mode !== 'db-exists' && mode !== 'app-write') usage('--mode must be db-exists or app-write')
  const token = mode === 'app-write' ? requireFlag(flags, 'token') : flags.token
  const timeoutSeconds = Number(flags.timeout || 120)
  const deadline = Date.now() + timeoutSeconds * 1000
  let attempts = 0
  let lastDetail = 'nothing observed yet'
  while (Date.now() < deadline) {
    attempts += 1
    if (mode === 'db-exists') {
      if (existsSync(dbPath) && statSync(dbPath).size > 0) {
        const header = readFileSync(dbPath).subarray(0, 15).toString('latin1')
        if (header === 'SQLite format 3') {
          pass('database appeared at ' + dbPath + ' after ' + attempts + ' probe(s)')
          return
        }
        lastDetail = 'file exists but its header is not "SQLite format 3": ' + JSON.stringify(header)
      }
    } else if (existsSync(dbPath)) {
      try {
        const db = new DatabaseSync(dbPath)
        db.exec('PRAGMA busy_timeout=5000')
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_settings')
        db.close()
        if (row) {
          try {
            const parsed = JSON.parse(row.value)
            if (parsed.terminalThemeLightMigrated === true && parsed.phase89Marker === token) {
              pass('the app rewrote the seeded settings row after ' + attempts +
                ' probe(s) (terminalThemeLightMigrated=true, marker intact)')
              return
            }
            lastDetail = 'settings row present but terminalThemeLightMigrated=' +
              JSON.stringify(parsed.terminalThemeLightMigrated) + ' marker=' + JSON.stringify(parsed.phase89Marker)
          } catch (error) {
            lastDetail = 'settings row is not valid JSON: ' + error.message
          }
        } else {
          lastDetail = 'no app_settings row yet'
        }
      } catch (error) {
        lastDetail = 'could not read the database: ' + error.message
      }
    } else {
      lastDetail = 'database file does not exist yet'
    }
    const pause = new Int32Array(new SharedArrayBuffer(4))
    Atomics.wait(pause, 0, 0, 1000)
  }
  fail(mode + ' condition not reached within ' + timeoutSeconds + 's after ' + attempts +
    ' probe(s); last observation: ' + lastDetail)
}

function cmdDigest(flags) {
  const dbPath = requireFlag(flags, 'db')
  const extra = typeof flags.file === 'string' ? [flags.file] : []
  for (const path of [dbPath, dbPath + '-wal', dbPath + '-shm'].concat(extra)) {
    const digest = fileDigest(path)
    info(digest.exists
      ? digest.bytes + ' bytes sha256 ' + digest.sha256 + ' ' + digest.path
      : 'absent ' + digest.path)
  }
}

/**
 * Test-only fault injection, so the platform scripts can prove their assertions
 * are live: it is refused unless VERIFY_INSTALL_TEST_MUTATION=1 is exported, it
 * only ever breaks a controlled fixture row, and a scripted run that reaches a
 * verification step afterwards MUST fail. It is never set in CI.
 */
function cmdTestBreak(flags) {
  if (process.env.VERIFY_INSTALL_TEST_MUTATION !== '1') {
    usage('test-break is refused without VERIFY_INSTALL_TEST_MUTATION=1 (it exists only to prove the assertions fail)')
  }
  const dbPath = requireFlag(flags, 'db')
  const token = requireFlag(flags, 'token')
  const mode = requireFlag(flags, 'mode')
  const db = openDb(dbPath)
  const hostId = 'phase89-host-' + token
  if (mode === 'delete-host') {
    const changes = db.prepare('DELETE FROM hosts WHERE id = ?').run(hostId).changes
    if (changes < 1) fail('[TEST] delete-host matched no row')
    else console.log('[TEST] deleted the seeded hosts row ' + hostId)
  } else if (mode === 'mutate-setting') {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_settings')
    const parsedSettings = JSON.parse(row.value)
    parsedSettings.fontSize = 99
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(parsedSettings), 'app_settings')
    console.log('[TEST] forced settings.app_settings.fontSize to 99')
  } else if (mode === 'mutate-host') {
    const changes = db.prepare("UPDATE hosts SET username = 'phase89-tampered' WHERE id = ?").run(hostId).changes
    if (changes < 1) fail('[TEST] mutate-host matched no row')
    else console.log('[TEST] changed hosts.username of ' + hostId)
  } else {
    db.close()
    usage('--mode must be delete-host, mutate-host or mutate-setting')
  }
  db.close()
  console.log('[TEST] deliberate mutation applied; the verification steps must now go red')
}

const parsed = parseArgs(process.argv.slice(2))
const handlers = {
  integrity: cmdIntegrity,
  schema: cmdSchema,
  seed: cmdSeed,
  snapshot: cmdSnapshot,
  verify: cmdVerify,
  wait: cmdWait,
  digest: cmdDigest,
  'test-break': cmdTestBreak
}

if (!parsed.command || !handlers[parsed.command]) {
  usage('unknown command ' + (parsed.command || '(none)') + '; expected one of ' + Object.keys(handlers).join(', '))
}

handlers[parsed.command](parsed.flags)

console.log('[SUMMARY] ' + PROVIDER + ' ' + parsed.command + ': ' + passes.length + ' passed, ' + failures.length + ' failed')
if (failures.length > 0) process.exit(1)
