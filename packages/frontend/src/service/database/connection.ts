/** Database connection lifecycle and query helpers. */
import { isTauri } from '@tauri-apps/api/core'
import { initializeCoreSchema } from './connection-schema-core'
import { initializeTeamSchema } from './connection-schema-team'

async function loadDb() {
  const Database = (await import('@tauri-apps/plugin-sql')).default
  return Database.load('sqlite:terminal.db')
}

type Database = Awaited<ReturnType<typeof loadDb>>
let db: Database | null = null
let initPromise: Promise<Database> | null = null

export async function getDb() {
  if (db) return db
  if (initPromise) return initPromise
  if (!isTauri()) throw new Error('Database only available in Tauri context')
  initPromise = (async () => {
    const database = await loadDb()
    db = database
    await initSchema()
    await configureSqlite()
    return database
  })()
  return initPromise
}

export async function configureSqlite() {
  const database = db!
  await database.execute('PRAGMA journal_mode=WAL')
  await database.execute('PRAGMA busy_timeout=30000')
  await database.execute('PRAGMA synchronous=NORMAL')
  await database.execute('PRAGMA cache_size=10000')
}

export async function initSchema() {
  const database = db!
  await initializeCoreSchema(database)
  await initializeTeamSchema(database)
}

export async function executeQuery(sql: string, params: unknown[] = []) {
  try {
    return await (await getDb()).execute(sql, params)
  } catch (error) {
    console.error('[Database] Query error:', {
      sql: sql.substring(0, 200),
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `Database query failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export async function select<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await (await getDb()).select<T>(sql, params)
    return Array.isArray(result) ? result : [result as T]
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Database only available in Tauri context'
    )
      throw error
    console.error('[Database] Select error:', {
      sql: sql.substring(0, 200),
      error: error instanceof Error ? error.message : String(error),
    })
    return [] as T[]
  }
}
