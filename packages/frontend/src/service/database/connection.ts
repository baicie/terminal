/** Database connection lifecycle and query helpers. */
import { isTauri } from '@tauri-apps/api/core'
import { initializeCoreSchema } from './connection-schema-core'
import { initializeTeamSchema } from './connection-schema-team'
import { traceStage, traceStageFailed } from './startup-trace'
import { assertDatabaseAllowed, blockStartup } from './startup-gate'

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
  let opened: Database | null = null
  try {
    traceStage(stage, 'sqlite:terminal.db')
    const database = await loadDb()
    opened = database
    traceStage('db-pool-registered', 'the sql plugin returned a handle')
    stage = 'schema-init'
    await initSchema(database)
    stage = 'pragmas'
    await configureSqlite(database)
    // Re-check before publishing: a lock that vanished while the schema was
    // being applied must not leave a usable cached connection behind.
    stage = 'runtime-lock'
    await assertRuntimeInstanceLock()
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
    if (opened) {
      try {
        await opened.close()
      } catch {
        // best effort: the handle is discarded either way
      }
    }
    db = null
    initPromise = null
    throw error
  }
}

/**
 * A process that lost the runtime instance lock must never ask plugin-sql to
 * open the file. The Rust commands enforce the same invariant; this check
 * closes the UI/service path as well.
 */
async function closeCachedConnection(): Promise<void> {
  const current = db
  db = null
  initPromise = null
  if (!current) return
  try {
    await current.close()
  } catch {
    // the handle is already unusable; dropping it is the safety property
  }
}

async function assertRuntimeInstanceLock(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  let held = false
  try {
    held = await invoke<boolean>('runtime_instance_lock_held')
  } catch (error) {
    await closeCachedConnection()
    blockStartup()
    throw new Error(
      'the runtime instance lock could not be verified: ' +
        (error instanceof Error ? error.message : String(error)),
      { cause: error },
    )
  }
  if (held !== true) {
    // The lock path was deleted or replaced: the cached handle and any
    // in-flight init must not remain usable for new statements.
    await closeCachedConnection()
    blockStartup()
    throw new Error(
      'this process does not own the runtime instance lock for the data directory',
    )
  }
}

export async function getDb() {
  // Gate first: a cached connection or an in-flight init must not be reachable
  // while the startup decision is pending or blocked.
  assertDatabaseAllowed()
  if (!isTauri()) throw new Error('Database only available in Tauri context')
  // Every call, including cache and in-flight hits, re-verifies ownership. A
  // lock file deleted after the first connection must close that connection
  // instead of letting new statements through it.
  await assertRuntimeInstanceLock()
  if (db) return db
  if (initPromise) return initPromise
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
    // A gate rejection must reach the caller; turning it into [] would look
    // like "no rows" and let business code run against a blocked database.
    assertDatabaseAllowed()
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
