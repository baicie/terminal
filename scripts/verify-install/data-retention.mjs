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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

function tableColumns(db, table) {
  return db
    .prepare("SELECT name FROM pragma_table_info('" + table + "')")
    .all()
    .map(function (row) { return row.name })
}

function hasTable(db, table) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table),
  )
}

/** Insert only the columns this version's table actually has. */
function insertCompatible(db, table, row) {
  if (!hasTable(db, table)) return false
  const existing = new Set(tableColumns(db, table))
  const keys = Object.keys(row).filter(function (key) { return existing.has(key) })
  if (keys.length === 0) return false
  const sql = 'INSERT OR REPLACE INTO "' + table + '" (' +
    keys.map(function (key) { return '"' + key + '"' }).join(', ') + ') VALUES (' +
    keys.map(function () { return '?' }).join(', ') + ')'
  db.prepare(sql).run(...keys.map(function (key) { return row[key] }))
  return true
}

function seededTeamRows(token) {
  const teamId = 'phase95-team-' + token
  return {
    team: {
      id: teamId, name: 'phase95-team-' + token, owner_id: 'phase95-user',
      mode: 'local', endpoint: null, api_token: null, auto_sync: 1,
      created_at: CREATED_AT, updated_at: CREATED_AT
    },
    member: {
      id: 'phase95-member-' + token, team_id: teamId, user_id: 'phase95-user',
      user_name: 'phase95-user', user_email: null, role: 'owner', joined_at: CREATED_AT
    },
    sharedHost: {
      id: 'phase95-shared-' + token, team_id: teamId,
      host_data: JSON.stringify({ id: 'phase95-shared-' + token, name: 'phase95-shared-' + token, hostname: 'shared.invalid' }),
      shared_by: 'phase95-user', permission: 'readonly', created_at: CREATED_AT
    },
    syncQueue: {
      id: 'phase95-queue-' + token, user_id: 'phase95-user', team_id: teamId,
      type: 'host', resource: 'team_shared_hosts', resource_id: 'phase95-shared-' + token,
      data: JSON.stringify({ marker: token }), status: 'pending', retry_count: 0,
      error: null, created_at: CREATED_AT, synced_at: null
    },
    profile: {
      id: 'phase95-user', name: 'phase95-user',
      created_at: CREATED_AT, updated_at: CREATED_AT
    }
  }
}

function collectTeamRows(db, token) {
  const teamId = 'phase95-team-' + token
  const row = function (table, where, value) {
    if (!hasTable(db, table)) return null
    return db.prepare('SELECT * FROM "' + table + '" WHERE ' + where + ' = ?').get(value) || null
  }
  return {
    team: row('teams', 'id', teamId),
    member: row('team_members', 'id', 'phase95-member-' + token),
    sharedHost: row('team_shared_hosts', 'id', 'phase95-shared-' + token),
    syncQueue: row('sync_queue', 'id', 'phase95-queue-' + token),
    profile: row('user_profile', 'id', 'phase95-user')
  }
}

function cmdSeed(flags) {
  const dbPath = requireFlag(flags, 'db')
  const token = requireFlag(flags, 'token')
  const vaultPath = typeof flags.vault === 'string' ? flags.vault : null
  // Upgrade mode: seed an older version's database, whose hosts table may not
  // have every column the current fixture knows about. Insert only the columns
  // that actually exist; the new ones are added by B's migration and asserted
  // there. Without this, A=dev.1 fails before the upgrade even starts.
  const compatible = flags.compatible === true
  const db = openDb(dbPath)
  const host = seededHost(token)
  const workspace = seededWorkspace(token)
  const settingsJson = JSON.stringify(seededSettings(token))
  const layoutJson = JSON.stringify(seededLayout(token))
  const existingHostColumns = compatible ? new Set(tableColumns(db, 'hosts')) : null
  const existingWorkspaceColumns = compatible ? new Set(tableColumns(db, 'workspaces')) : null
  const hostColumns = Object.keys(host).filter(
    function (column) { return !existingHostColumns || existingHostColumns.has(column) },
  )
  const workspaceColumnValues = {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    icon: workspace.icon,
    color: workspace.color,
    '"order"': workspace.order,
    is_active: workspace.is_active,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at
  }
  const wsColumns = Object.keys(workspaceColumnValues).filter(function (column) {
    return !existingWorkspaceColumns || existingWorkspaceColumns.has(column.replaceAll('"', ''))
  })
  const wsValues = wsColumns.map(function (column) { return workspaceColumnValues[column] })
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
  const teamRows = seededTeamRows(token)
  const seededTeamTables = []
  for (const [table, row] of [
    ['teams', teamRows.team],
    ['team_members', teamRows.member],
    ['team_shared_hosts', teamRows.sharedHost],
    ['sync_queue', teamRows.syncQueue],
    ['user_profile', teamRows.profile]
  ]) {
    if (insertCompatible(db, table, row)) seededTeamTables.push(table)
  }

  pass('seeded hosts row id=' + host.id + ' (auth_type=agent, password NULL, private_key NULL)')
  pass('seeded settings row key=app_settings (marker=' + token + ')')
  pass('seeded workspaces row id=' + workspace.id + ' and its workspace_layouts row')
  pass('seeded team sync rows: ' + (seededTeamTables.join(', ') || 'none (A has no team schema)'))

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
      .get('phase89-ws-' + token) || null,
    team: collectTeamRows(db, token)
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
    schema: (function () {
      const columns = {}
      for (const table of db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all()) {
        columns[table.name] = tableColumns(db, table.name)
      }
      return columns
    })(),
    counts: {
      hosts: singleValue(db, 'SELECT COUNT(*) FROM hosts'),
      workspaces: singleValue(db, 'SELECT COUNT(*) FROM workspaces'),
      settings: singleValue(db, 'SELECT COUNT(*) FROM settings'),
      layouts: singleValue(db, 'SELECT COUNT(*) FROM workspace_layouts'),
      teams: hasTable(db, 'teams') ? singleValue(db, 'SELECT COUNT(*) FROM teams') : 0,
      syncQueue: hasTable(db, 'sync_queue') ? singleValue(db, 'SELECT COUNT(*) FROM sync_queue') : 0
    },
    host: rows.host,
    team: rows.team,
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
    layout: snapshot.layout,
    team: snapshot.team
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
  const allowSettingsMigration = flags['allow-settings-migration'] === true
  const allowEncryptedVault = flags['vault-allow-encrypted'] === true
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

  // Upgrade mode: compare only the columns A actually had; B may add columns.
  // A missing old column is still a failure; a new column is reported and, when
  // the caller names it in --expected-new-host-columns, gated for existence.
  const beforeHostColumns = before.schema && Array.isArray(before.schema.hosts)
    ? before.schema.hosts
    : null
  if (before.schema) {
    for (const table of Object.keys(before.schema)) {
      const afterColumns = tableColumns(db, table)
      for (const column of before.schema[table]) {
        check(afterColumns.includes(column), 'schema: ' + table + '.' + column + ' still exists')
      }
    }
  }
  const expectedNewHostColumns = typeof flags['expected-new-host-columns'] === 'string'
    ? flags['expected-new-host-columns'].split(',').map(function (value) { return value.trim() }).filter(Boolean)
    : []
  const forbiddenHostColumns = typeof flags['forbid-columns'] === 'string'
    ? flags['forbid-columns'].split(',').map(function (value) { return value.trim() }).filter(Boolean)
    : []
  const afterHostColumns = tableColumns(db, 'hosts')
  for (const column of expectedNewHostColumns) {
    check(afterHostColumns.includes(column), 'schema: new hosts column "' + column + '" was added by the upgrade')
  }
  for (const column of forbiddenHostColumns) {
    check(!afterHostColumns.includes(column), 'schema: forbidden new hosts column "' + column + '" is absent')
  }

  const rows = collectRows(db, token)
  const hostFields = beforeHostColumns
    ? HOST_FIELDS.filter(function (field) { return beforeHostColumns.includes(field) })
    : HOST_FIELDS
  compareRow('hosts', before.host, rows.host, hostFields)
  if (rows.host) {
    for (const column of expectedNewHostColumns) {
      if (afterHostColumns.includes(column)) {
        info('hosts.' + column + ' after upgrade = ' + JSON.stringify(rows.host[column]))
      }
    }
  }
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

  if (before.team) {
    for (const key of ['team', 'member', 'sharedHost', 'syncQueue', 'profile']) {
      const expected = before.team[key]
      if (!expected) continue
      const actual = rows.team ? rows.team[key] : null
      compareRow('team.' + key, expected, actual, Object.keys(expected))
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
      // Compare every key the fixture carried, not a hand-picked subset. A
      // syncServiceToken or notification preference must not disappear just
      // because it was not in SETTINGS_ASSERTED. The two terminalThemeLight
      // fields are the app's one-time migration and are reported below.
      for (const field of Object.keys(beforeParsed)) {
        if (field === 'terminalThemeLight' || field === 'terminalThemeLightMigrated') continue
        check(
          canonical(parsed[field]) === canonical(beforeParsed[field]),
          'settings.app_settings.' + field + ' == ' + JSON.stringify(parsed[field]) +
            ' (expected ' + JSON.stringify(beforeParsed[field]) + ')'
        )
      }
      for (const field of Object.keys(parsed)) {
        if (!(field in beforeParsed)) info('settings gained a new key after upgrade: ' + field)
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
      } else if (allowSettingsMigration) {
        // Across an upgrade, B may legitimately perform the one-time
        // terminalThemeLight migration. Report the value instead of gating it;
        // the seeded marker and the user-owned settings fields are still gated.
        info('settings.terminalThemeLightMigrated ' +
          JSON.stringify(beforeParsed.terminalThemeLightMigrated) + ' -> ' +
          JSON.stringify(parsed.terminalThemeLightMigrated) + ' (one-time app migration; reported, not gated)')
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
    if (vault.parses && !allowEncryptedVault) {
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

function parseExpectedColumns(value) {
  if (typeof value !== 'string' || value.length === 0) usage('--expect-columns is required for migration-columns mode')
  const expected = {}
  for (const group of value.split(';')) {
    const [table, columns] = group.split(':')
    if (!table || !columns) usage('--expect-columns format is table:column[,column];table:column')
    expected[table] = columns.split(',').map(function (column) { return column.trim() }).filter(Boolean)
  }
  return expected
}

function cmdWait(flags) {
  const dbPath = requireFlag(flags, 'db')
  const mode = typeof flags.mode === 'string' ? flags.mode : 'db-exists'
  if (mode !== 'db-exists' && mode !== 'app-write' && mode !== 'migration-columns') {
    usage('--mode must be db-exists, app-write or migration-columns')
  }
  const token = mode === 'app-write' ? requireFlag(flags, 'token') : flags.token
  const expectedColumns = mode === 'migration-columns'
    ? parseExpectedColumns(flags['expect-columns'])
    : null
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
    } else if (mode === 'migration-columns') {
      if (!existsSync(dbPath)) {
        lastDetail = 'database file does not exist yet'
      } else {
        try {
          const db = new DatabaseSync(dbPath)
          db.exec('PRAGMA busy_timeout=5000')
          const missing = []
          for (const table of Object.keys(expectedColumns)) {
            const present = new Set(
              db.prepare("SELECT name FROM pragma_table_info('" + table + "')").all()
                .map(function (row) { return row.name }),
            )
            for (const column of expectedColumns[table]) {
              if (!present.has(column)) missing.push(table + '.' + column)
            }
          }
          const integrity = String(db.prepare('PRAGMA integrity_check').get().integrity_check)
          db.close()
          if (missing.length === 0 && integrity === 'ok') {
            pass('B migrated the schema after ' + attempts + ' probe(s): ' +
              Object.keys(expectedColumns).map(function (table) {
                return table + '.' + expectedColumns[table].join('+')
              }).join('; ') + ' present, integrity ok')
            return
          }
          lastDetail = 'missing=' + (missing.join(',') || 'none') + ' integrity=' + integrity
        } catch (error) {
          lastDetail = 'could not read the database: ' + error.message
        }
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

function cmdCheckpoint(flags) {
  const dbPath = requireFlag(flags, 'db')
  const db = openDb(dbPath)
  try {
    // PRAGMA wal_checkpoint returns (busy, log, checkpointed). The old code
    // discarded that row and always reported success, so a busy checkpoint
    // could be followed by deleting a WAL that still held committed frames.
    const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
    const busy = Number(row.busy)
    const log = Number(row.log)
    const checkpointed = Number(row.checkpointed)
    if (busy !== 0) {
      fail('WAL checkpoint stayed busy (busy=' + busy + ', log=' + log +
        ', checkpointed=' + checkpointed + ') on ' + dbPath)
      process.exit(1)
    }
    if (log !== checkpointed) {
      fail('WAL checkpoint did not cover all frames (log=' + log +
        ', checkpointed=' + checkpointed + ') on ' + dbPath)
      process.exit(1)
    }
    const wal = dbPath + '-wal'
    if (existsSync(wal) && statSync(wal).size > 0) {
      fail('WAL file is still non-empty after checkpoint: ' + wal)
      process.exit(1)
    }
    pass('WAL checkpoint completed and verified on ' + dbPath)
  } finally {
    db.close()
  }
}

function cmdBackupVerify(flags) {
  const directory = requireFlag(flags, 'dir')
  const token = requireFlag(flags, 'token')
  const out = typeof flags.out === 'string' ? flags.out : null
  if (!existsSync(directory)) usage('backup directory does not exist: ' + directory)
  const snapshots = readdirSync(directory)
    .filter(function (name) { return /^pre-migration-\d+(?:-\d+)?\.db$/.test(name) })
    .map(function (name) {
      const path = join(directory, name)
      const stamp = Number(/^pre-migration-(\d+)/.exec(name)[1])
      return { name: name, path: path, mtimeMs: statSync(path).mtimeMs, stamp: stamp }
    })
    // The first snapshot predates the first ALTER; recovery snapshots may
    // already contain B's columns and must not be adopted as pre-migration.
    .sort(function (left, right) { return left.stamp - right.stamp })
  check(snapshots.length > 0, 'a pre-migration snapshot exists in ' + directory)
  if (snapshots.length === 0) return
  const newest = snapshots[0]
  const db = openDb(newest.path)
  const integrity = String(singleValue(db, 'PRAGMA integrity_check'))
  check(integrity === 'ok', 'backup integrity_check => ' + integrity + ' (' + newest.name + ')')
  const rows = collectRows(db, token)
  check(Boolean(rows.host), 'backup still carries the seeded host')
  check(Boolean(rows.settings), 'backup still carries the seeded settings row')
  check(Boolean(rows.workspace), 'backup still carries the seeded workspace')
  check(Boolean(rows.layout), 'backup still carries the seeded workspace layout')
  db.close()
  const report = {
    directory: directory,
    newest: newest.name,
    snapshots: snapshots.map(function (snapshot) { return snapshot.name }),
    integrity: integrity,
    hostReadable: Boolean(rows.host),
    settingsReadable: Boolean(rows.settings),
    workspaceReadable: Boolean(rows.workspace),
    layoutReadable: Boolean(rows.layout)
  }
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
    info('backup verification written to ' + out)
  } else {
    info(JSON.stringify(report))
  }
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
  checkpoint: cmdCheckpoint,
  'backup-verify': cmdBackupVerify,
  digest: cmdDigest,
  'test-break': cmdTestBreak
}

if (!parsed.command || !handlers[parsed.command]) {
  usage('unknown command ' + (parsed.command || '(none)') + '; expected one of ' + Object.keys(handlers).join(', '))
}

handlers[parsed.command](parsed.flags)

console.log('[SUMMARY] ' + PROVIDER + ' ' + parsed.command + ': ' + passes.length + ' passed, ' + failures.length + ' failed')
if (failures.length > 0) process.exit(1)
