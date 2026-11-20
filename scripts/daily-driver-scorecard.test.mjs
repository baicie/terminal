// The scorecard must not grade a week that did not happen.
//
// A tool that prints PASS for zero sessions turns "I did not use the app" into
// "the app worked for a week". These tests pin the three verdicts and the exit code,
// because the exit code is what a CI job or a human's script would read.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/daily-driver-scorecard.mjs')

/*
 * `node:sqlite` is built in from Node 22.5 (behind a flag) and 24 (unflagged). The
 * scorecard is a diagnostic a developer runs against their own database, not a CI
 * gate — so on a Node that cannot open it, these tests **skip and say so** rather than
 * failing the suite for a missing built-in.
 */
const sqlite = await import('node:sqlite').catch(() => null)
if (sqlite === null) {
  test('daily driver scorecard', { skip: 'node:sqlite is unavailable on this Node' }, () => {})
} else {
  describeScorecard(sqlite.DatabaseSync)
}

function describeScorecard(DatabaseSync) {

/** Build a throwaway database with the columns the scorecard reads. */
function databaseWith(rows) {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE connection_logs (
    id TEXT PRIMARY KEY, host_id TEXT, host_name TEXT, host_address TEXT,
    username TEXT, connection_type TEXT, started_at INTEGER, ended_at INTEGER,
    duration_seconds INTEGER, is_saved INTEGER, notes TEXT, error_message TEXT,
    error_raw TEXT
  )`)
  const insert = db.prepare(
    `INSERT INTO connection_logs (id, connection_type, host_name, started_at,
      ended_at, duration_seconds, error_message) VALUES (?,?,?,?,?,?,?)`,
  )
  rows.forEach((row, index) => {
    insert.run(
      `id-${index}`,
      row.type ?? 'ssh',
      row.host ?? 'host',
      row.startedAt,
      row.startedAt + 1000,
      row.duration ?? 60,
      row.error ?? null,
    )
  })
  return db
}

/** Run the script against a database file and report its verdict + exit code. */
function run(db, extraArgs = []) {
  // A directory of its own: two test files running in parallel must not collide on a
  // file name, and a failed cleanup must not leave a database in the repository root.
  const dir = mkdtempSync(path.join(tmpdir(), 'scorecard-'))
  const file = path.join(dir, 'terminal.db')
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  try {
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, '--db', file, '--json', ...extraArgs],
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--experimental-sqlite' } },
    )
    return { exitCode: 0, report: JSON.parse(stdout) }
  } catch (error) {
    return { exitCode: error.status, report: JSON.parse(error.stdout) }
  } finally {
    try {
      execFileSync(process.execPath, ['-e', `require('node:fs').unlinkSync(${JSON.stringify(file)})`], {
        env: { ...process.env, NODE_OPTIONS: '--experimental-sqlite' },
      })
    } catch {
      // The file is in a temp location; failing to remove it must not fail the test.
    }
  }
}

const day = 24 * 60 * 60 * 1000
const now = Date.now()

test('no sessions is NOT_RUN, not a pass', () => {
  const { exitCode, report } = run(databaseWith([]))
  assert.equal(report.verdict, 'NOT_RUN')
  assert.equal(exitCode, 1, 'an empty window must not exit 0; that reads as success')
  assert.match(report.note, /not a pass/i)
})

test('one session in a week is PARTIAL, not MEASURED', () => {
  // A week of use that produced one session describes nothing about a daily driver.
  const { report } = run(
    databaseWith([{ startedAt: now - 2 * day, type: 'ssh' }]),
  )
  assert.equal(report.verdict, 'PARTIAL')
  assert.equal(report.activeDays, 1)
})

test('enough sessions across enough days is MEASURED', () => {
  const rows = []
  for (let d = 0; d < 6; d += 1) {
    for (let s = 0; s < 3; s += 1) {
      rows.push({ startedAt: now - d * day - s * 60_000, type: s === 0 ? 'ssh' : 'local' })
    }
  }
  const { exitCode, report } = run(databaseWith(rows))
  assert.equal(report.verdict, 'MEASURED')
  assert.equal(exitCode, 0)
  assert.equal(report.sessions, 18)
  assert.equal(report.activeDays, 6)
})

test('rows outside the window do not count', () => {
  const rows = [
    { startedAt: now - 30 * day },
    { startedAt: now - 20 * day },
  ]
  const { report } = run(databaseWith(rows))
  assert.equal(report.sessions, 0, 'the window is what the reader asked about')
  assert.equal(report.verdict, 'NOT_RUN')
})

test('failures are counted and reported as a rate', () => {
  const rows = []
  for (let d = 0; d < 6; d += 1) {
    for (let s = 0; s < 3; s += 1) {
      rows.push({
        startedAt: now - d * day - s * 60_000,
        error: s === 0 ? 'connection refused' : null,
      })
    }
  }
  const { report } = run(databaseWith(rows))
  assert.equal(report.failures, 6)
  assert.equal(report.failureRate, 33.3)
})
}
