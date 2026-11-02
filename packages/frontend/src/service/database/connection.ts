/** Database connection lifecycle and query helpers. */
import { isTauri } from '@tauri-apps/api/core'
import { initializeCoreSchema } from './connection-schema-core'
import { initializeTeamSchema } from './connection-schema-team'
import { traceStage, traceStageFailed } from './startup-trace'

async function loadDb() {
  const Database = (await import('@tauri-apps/plugin-sql')).default
  return Database.load('sqlite:terminal.db')
}

type Database = Awaited<ReturnType<typeof loadDb>>
let db: Database | null = null
let initPromise: Promise<Database> | null = null

function requireDb(): Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

/**
 * Open the connection and apply schema + pragmas. The handle is published to
 * `db` only after both steps succeeded, so a failed setup is never cached as a
 * usable connection: the next getDb() call retries from scratch.
 */
async function establishConnection(): Promise<Database> {
  let stage = 'db-load-started'
  try {
    traceStage(stage, 'sqlite:terminal.db')
    const database = await loadDb()
    traceStage('db-pool-registered', 'the sql plugin returned a handle')
    stage = 'schema-init'
    await initSchema(database)
    stage = 'pragmas'
    await configureSqlite(database)
    db = database
    traceStage('ready', 'connection cached')
    return database
  } catch (error) {
    traceStageFailed(stage, error)
    // The app has no log plugin and no error bridge to Rust, so a failure here
    // is invisible to anything reading the process output. Console output does
    // reach the webview log, which the macOS install-verification harness now
    // collects - that is what turns "the tables were never created" into an
    // actual reason.
    console.error('[db] schema setup failed, the connection was not cached', error)
    db = null
    initPromise = null
    throw error
  }
}

export async function getDb() {
  if (db) return db
  if (initPromise) return initPromise
  if (!isTauri()) throw new Error('Database only available in Tauri context')
  initPromise = establishConnection()
  return initPromise
}

export async function configureSqlite(database: Database = requireDb()) {
  await database.execute('PRAGMA journal_mode=WAL')
  await database.execute('PRAGMA busy_timeout=30000')
  await database.execute('PRAGMA synchronous=NORMAL')
  await database.execute('PRAGMA cache_size=10000')
}

export async function initSchema(database: Database = requireDb()) {
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

/**
 * Read a startup-critical query without converting database failures into an
 * empty result. Recovery uses this to distinguish "no rows" from "could not
 * read the database" and preserve the user's last usable terminal layout.
 */
export async function selectStrict<T>(
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
    ) {
      throw error
    }
    console.error('[Database] Strict select error:', {
      sql: sql.substring(0, 200),
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `Database query failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
