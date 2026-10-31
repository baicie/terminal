import { expect, it, vi } from 'vitest'
import { initializeCoreSchema } from './connection-schema-core'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const ALTERS = [
  'ALTER TABLE connection_logs ADD COLUMN error_message TEXT',
  'ALTER TABLE connection_logs ADD COLUMN error_raw TEXT',
  'ALTER TABLE hosts ADD COLUMN certificate TEXT',
  'ALTER TABLE hosts ADD COLUMN jump_host_id TEXT',
  'ALTER TABLE hosts ADD COLUMN jump_host_auth_type TEXT',
  'ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0',
  "ALTER TABLE hosts ADD COLUMN shell_integration TEXT DEFAULT 'off'",
]

const HOST_COLUMNS = [
  'id',
  'name',
  'hostname',
  'port',
  'username',
  'auth_type',
  'password',
  'private_key',
  'certificate',
  'group_id',
  'is_favorite',
  'color',
  'tags',
  'port_forwards',
  'startup_command',
  'environment',
  'jump_host_id',
  'jump_host_auth_type',
  'agent_forwarding',
  'shell_integration',
]
const LOG_COLUMNS = ['id', 'error_message', 'error_raw']

/** A connection whose schema is described by `tables`, i.e. by what already exists. */
function connectionWith(tables: Record<string, string[]>) {
  const select = vi.fn(async (sql: string, params: unknown[] = []) => {
    const table = String(params[0])
    if (sql.includes('sqlite_master'))
      return table in tables ? [{ name: table }] : []
    if (sql.includes('pragma_table_info'))
      return (tables[table] ?? []).map(name => ({ name }))
    throw new Error(`unexpected schema query: ${sql}`)
  })
  return select
}

/** A database that is one release behind: both tables exist without the new columns. */
const legacyTables = { hosts: HOST_COLUMNS.slice(0, 12), connection_logs: ['id'] }

it('creates and migrates the host agent forwarding setting', async () => {
  const execute = vi.fn().mockResolvedValue(undefined)

  await initializeCoreSchema({ execute })

  const statements = execute.mock.calls.map(([sql]) => String(sql))
  expect(
    statements.some(sql => sql.includes('agent_forwarding INTEGER DEFAULT 0')),
  ).toBe(true)
  expect(statements).toContain(
    'ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0',
  )
  expect(
    statements.some(sql =>
      sql.includes("shell_integration TEXT DEFAULT 'off'"),
    ),
  ).toBe(true)
  expect(statements).toContain(
    "ALTER TABLE hosts ADD COLUMN shell_integration TEXT DEFAULT 'off'",
  )
})

it('ignores the duplicate column error an existing database reports', async () => {
  const execute = vi.fn(async (sql: string) => {
    if (!sql.startsWith('ALTER TABLE')) return
    const column = sql.split(' ')[5]
    throw new Error(
      `error returned from database: duplicate column name: ${column}`,
    )
  })

  await expect(initializeCoreSchema({ execute })).resolves.toBeUndefined()

  const attempted = execute.mock.calls
    .map(([sql]) => String(sql))
    .filter(sql => sql.startsWith('ALTER TABLE'))
  expect(attempted).toEqual(ALTERS)
})

it('rethrows a migration failure that is not a duplicate column', async () => {
  const failure = new Error('disk I/O error')
  const attempted: string[] = []
  const execute = vi.fn(async (sql: string) => {
    attempted.push(sql)
    if (sql === ALTERS[0]) throw failure
  })

  await expect(initializeCoreSchema({ execute })).rejects.toBe(failure)

  // The loop stopped at the first unexpected failure: neither the remaining column
  // migrations nor the statements after them were applied to a database in an unknown
  // state.
  expect(attempted.filter(sql => sql.startsWith('ALTER TABLE'))).toEqual([
    ALTERS[0],
  ])
  expect(attempted.some(sql => sql.includes('idx_scripts_enabled'))).toBe(false)
})

it.each([
  ['a full disk', 'database or disk is full'],
  ['a locked database', 'database is locked'],
  ['a read-only database', 'attempt to write a readonly database'],
  ['a syntax error', 'near "ADD": syntax error'],
  ['a missing column', 'no such column: certificate'],
  ['an I/O failure', 'disk I/O error'],
])('does not swallow %s', async (_label, message) => {
  const execute = vi.fn(async (sql: string) => {
    if (sql.startsWith('ALTER TABLE')) throw new Error(message)
  })

  await expect(initializeCoreSchema({ execute })).rejects.toThrow(message)
})

it('snapshots the database before it runs a single schema statement', async () => {
  const order: string[] = []
  invoke.mockReset().mockImplementation(async (command: string) => {
    order.push(`invoke:${command}`)
    return { path: '/backups/pre-migration-1.db', tables: 2, rows: 12 }
  })
  const execute = vi.fn(async (sql: string) => {
    order.push(sql)
  })
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})

  await initializeCoreSchema({ execute, select: connectionWith(legacyTables) })

  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith('backup_database_before_migration')
  expect(order[0]).toBe('invoke:backup_database_before_migration')
  expect(order.some(entry => entry.startsWith('CREATE TABLE'))).toBe(true)
  expect(info.mock.calls.join(' ')).toContain('/backups/pre-migration-1.db')
  info.mockRestore()
})

it('aborts without a single statement when the snapshot cannot be taken', async () => {
  const failure = new Error('database or disk is full')
  invoke.mockReset().mockRejectedValue(failure)
  const execute = vi.fn(async () => undefined)

  const error = await initializeCoreSchema({
    execute,
    select: connectionWith(legacyTables),
  }).catch((caught: unknown) => caught)

  expect(error).toBeInstanceOf(Error)
  expect(String((error as Error).message)).toMatch(
    /pre-migration snapshot failed, so the schema was not migrated/,
  )
  expect(String((error as Error).message)).toContain(
    'database or disk is full',
  )
  expect((error as Error).cause).toBe(failure)
  // Not one CREATE, not one ALTER: the database the snapshot failed on is untouched.
  expect(execute).not.toHaveBeenCalled()
})

it('refuses to migrate when the backend reports no snapshot path', async () => {
  invoke.mockReset().mockResolvedValue({ tables: 2, rows: 12 })
  const execute = vi.fn(async () => undefined)

  await expect(
    initializeCoreSchema({ execute, select: connectionWith(legacyTables) }),
  ).rejects.toThrow(/pre-migration snapshot failed/)
  expect(execute).not.toHaveBeenCalled()
})

it('does not snapshot a database that already has every column', async () => {
  invoke.mockReset()
  const execute = vi.fn(async () => undefined)

  await initializeCoreSchema({
    execute,
    select: connectionWith({ hosts: HOST_COLUMNS, connection_logs: LOG_COLUMNS }),
  })

  expect(invoke).not.toHaveBeenCalled()
  expect(execute).toHaveBeenCalled()
})

it('does not snapshot a database that has no tables yet', async () => {
  invoke.mockReset()
  const execute = vi.fn(async (_sql: string) => undefined)

  await initializeCoreSchema({ execute, select: connectionWith({}) })

  expect(invoke).not.toHaveBeenCalled()
  expect(
    execute.mock.calls
      .map(([sql]) => String(sql))
      .filter(sql => sql.startsWith('CREATE TABLE')),
  ).not.toHaveLength(0)
})
