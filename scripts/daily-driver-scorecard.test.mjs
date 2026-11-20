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
 * The pure parts, imported directly.
 *
 * `parseDays` and `localDayKey` are the rules that used to be inlined and therefore
 * untestable — `Number(flag('--days') ?? 7)` had no case that could fail because there
 * was nothing to call.
 */
const scorecardModule = await import('./daily-driver-scorecard.mjs')

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

/**
 * Run with raw arguments and no database, reporting only the exit code and payload.
 *
 * Used for the argument-validation cases: those must fail before the database is
 * opened, so giving them one would test the wrong thing.
 */
function runRaw(extraArgs) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...extraArgs], {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '--experimental-sqlite' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { exitCode: 0, report: stdout.trim() ? JSON.parse(stdout) : null }
  } catch (error) {
    const stdout = String(error.stdout ?? '').trim()
    let report = null
    try {
      report = stdout ? JSON.parse(stdout) : null
    } catch {
      report = null
    }
    return { exitCode: error.status ?? 1, report }
  }
}

const day = 24 * 60 * 60 * 1000
const now = Date.now()

test('no sessions is NOT_RUN, not a pass', () => {
  const { exitCode, report } = run(databaseWith([]))
  assert.equal(report.verdicts.dataCoverage, 'NOT_RUN')
  assert.equal(exitCode, 1, 'an empty window must not exit 0; that reads as success')
  assert.match(report.note, /not a pass/i)
})

test('one session in a week is PARTIAL, not MEASURED', () => {
  // A week of use that produced one session describes nothing about a daily driver.
  const { report } = run(
    databaseWith([{ startedAt: now - 2 * day, type: 'ssh' }]),
  )
  assert.equal(report.verdicts.dataCoverage, 'PARTIAL')
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
  assert.equal(report.verdicts.dataCoverage, 'MEASURED')
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
  assert.equal(report.verdicts.dataCoverage, 'NOT_RUN')
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

/*
 * ## Invalid arguments must not look like "no usage"
 *
 * Measured before this was fixed: `--days abc` became `NaN`, the query window was
 * empty, and the tool printed `NOT_RUN` with exit 1 — the same output and the same code
 * as a week in which the user genuinely did not open the app. A typo could therefore
 * report a week as not having happened, and nothing in the output said otherwise.
 */
for (const bad of ['abc', '0', '-5', '1.5', '99999', '']) {
  test(`--days ${JSON.stringify(bad)} is a tool error, not a usage verdict`, () => {
    const { exitCode, report } = runRaw(['--days', bad])
    assert.equal(exitCode, 2, 'bad input must be distinguishable from an empty window')
    assert.equal(report, null, 'no report is produced for unusable input')
  })
}

test('a valid --days still works', () => {
  const { exitCode, report } = run(databaseWith([]), ['--days', '7'])
  assert.equal(report.verdicts.dataCoverage, 'NOT_RUN')
  assert.equal(exitCode, 1)
})

/*
 * ## The three states, kept apart
 *
 * The single `verdict` field said `MEASURED`, which a reader could take as "the
 * product is ready". It never meant that, and the task brief says explicitly that
 * `MEASURED` must not become `READY`. These assertions exist so the collapse cannot
 * happen in a downstream script either.
 */
test('MEASURED does not claim automated or manual acceptance', () => {
  const rows = []
  for (let d = 0; d < 6; d += 1) {
    for (let s = 0; s < 3; s += 1) rows.push({ startedAt: now - d * day - s * 60_000 })
  }
  const { report } = run(databaseWith(rows))
  assert.equal(report.verdicts.dataCoverage, 'MEASURED')
  assert.equal(report.verdicts.automatedAcceptance.state, 'NOT_MEASURED')
  assert.equal(report.verdicts.manual7DayAcceptance.state, 'NOT_MEASURED')
  assert.match(report.note, /not that the product is ready/i)
})

/*
 * ## Local days, not UTC days
 *
 * `toISOString().slice(0, 10)` is the UTC date. Two sessions in one local evening can
 * split across the UTC midnight while being the same working day — and the opposite
 * happens too. `activeDays` is what the verdict threshold reads, so the count has to
 * follow the user's calendar.
 *
 * The test asserts the property rather than a specific offset, so it holds wherever CI
 * runs: a timestamp and the same timestamp + 1 hour are 0 or 1 days apart, never a
 * negative or fractional count.
 */
test('active days follow the local calendar', () => {
  const { localDayKey } = scorecardModule
  const noon = new Date(2026, 10, 20, 12, 0, 0).getTime()
  assert.equal(localDayKey(noon), '2026-11-20')
  // One minute before local midnight is still that day; one minute after is the next.
  const midnight = new Date(2026, 10, 21, 0, 0, 0).getTime()
  assert.equal(localDayKey(midnight - 60_000), '2026-11-20')
  assert.equal(localDayKey(midnight + 60_000), '2026-11-21')
})

/*
 * ## One session recorded twice is one session
 *
 * The log is written on some paths per attempt and on others per session. Counting a
 * duplicate would inflate `sessionsPerActiveDay`, which is a threshold input — a thin
 * week could pass on double-counted rows.
 */
test('a duplicate row does not inflate the session count', () => {
  const at = now - day
  const { report } = run(
    databaseWith([
      { startedAt: at, host: 'h-1' },
      { startedAt: at, host: 'h-1' }, // the same session, written twice
      { startedAt: at, host: 'h-2' }, // a different host at the same instant is real
    ]),
  )
  assert.equal(report.rawRows, 3)
  assert.equal(report.sessions, 2, 'the same host at the same instant is one session')
})
}
