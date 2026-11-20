#!/usr/bin/env node
/**
 * Daily Driver scorecard, computed from what the app itself recorded.
 *
 * ## What this can and cannot produce
 *
 * It reads `connection_logs` from the user's own database: real sessions, real
 * durations, real failures. That is evidence of use — not a script pretending to be a
 * user. What it cannot do is decide whether the product was *good*; the scorecard is
 * counts, and a human still has to read them.
 *
 * ## Why it refuses to grade an empty week
 *
 * A tool that prints `PASS` for "zero sessions" would let a week of not using the app
 * look like a week of the app working. So the verdict is `NOT_RUN` until there is
 * enough data to mean something, and the thresholds are stated in the output rather
 * than hidden here.
 *
 *   node scripts/daily-driver-scorecard.mjs [--db <path>] [--days 7] [--json]
 *
 * The database path defaults to the app's own config directory for this platform.
 */
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const IDENTIFIER = 'com.baicie.termius'

/** Where the app keeps its database, per platform. */
function defaultDatabasePath() {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library/Application Support', IDENTIFIER, 'terminal.db')
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData/Roaming'), IDENTIFIER, 'terminal.db')
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), IDENTIFIER, 'terminal.db')
}

/** Minimum activity for a week's numbers to mean anything. */
const THRESHOLDS = {
  /** Days with at least one session. A 7-day scorecard with 3 active days is not a week of use. */
  activeDays: 5,
  /** Sessions per active day, below which the sample is too thin to describe habits. */
  sessionsPerActiveDay: 2,
}

const argv = process.argv.slice(2)
const flag = name => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const dbPath = flag('--db') ?? defaultDatabasePath()
const days = Number(flag('--days') ?? 7)
const asJson = argv.includes('--json')

if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`)
  console.error('Run the app at least once, or pass --db <path>.')
  process.exit(2)
}

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(dbPath, { readOnly: true })

const now = Date.now()
const since = now - days * 24 * 60 * 60 * 1000

/** Rows from the window, newest first. */
const rows = db
  .prepare(
    `SELECT connection_type, host_name, started_at, ended_at, duration_seconds,
            error_message
       FROM connection_logs
      WHERE started_at >= ?
      ORDER BY started_at DESC`,
  )
  .all(since)

db.close()

const dayKey = ms => new Date(ms).toISOString().slice(0, 10)
const activeDays = new Set(rows.map(row => dayKey(row.started_at)))
const byType = rows.reduce((acc, row) => {
  acc[row.connection_type] = (acc[row.connection_type] ?? 0) + 1
  return acc
}, {})
const failures = rows.filter(row => row.error_message)
const durations = rows
  .map(row => row.duration_seconds)
  .filter(value => typeof value === 'number' && value > 0)
  .sort((a, b) => a - b)

const median = values =>
  values.length === 0
    ? null
    : values.length % 2 === 1
      ? values[(values.length - 1) / 2]
      : Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2)

const sessionsPerActiveDay =
  activeDays.size === 0 ? 0 : Math.round((rows.length / activeDays.size) * 10) / 10

/*
 * The verdict rule, stated where the reader can check it.
 *
 * `NOT_RUN` is not a failure of the product — it says the week did not happen, which is
 * what an empty or thin window means. `PARTIAL` says it happened but not enough to
 * describe a week. Only a window that clears both thresholds is graded at all.
 */
const verdict =
  rows.length === 0
    ? 'NOT_RUN'
    : activeDays.size < THRESHOLDS.activeDays ||
        sessionsPerActiveDay < THRESHOLDS.sessionsPerActiveDay
      ? 'PARTIAL'
      : 'MEASURED'

const report = {
  windowDays: days,
  database: dbPath,
  sessions: rows.length,
  activeDays: activeDays.size,
  sessionsPerActiveDay,
  byType,
  failures: failures.length,
  failureRate: rows.length === 0 ? null : Math.round((failures.length / rows.length) * 1000) / 10,
  medianDurationSeconds: median(durations),
  thresholds: THRESHOLDS,
  verdict,
  note:
    verdict === 'MEASURED'
      ? 'Counts only. Whether the week was good is the human part of the scorecard.'
      : 'Not enough real use in this window to describe a week. This is not a pass.',
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  process.stdout.write(
    [
      `Daily Driver scorecard — last ${days} days`,
      `  database      ${dbPath}`,
      `  sessions      ${report.sessions} (${activeDays.size} active days, ${sessionsPerActiveDay}/day)`,
      `  by type       ${JSON.stringify(byType)}`,
      `  failures      ${report.failures} (${report.failureRate ?? '—'}%)`,
      `  median        ${report.medianDurationSeconds ?? '—'}s`,
      `  verdict       ${verdict}`,
      '',
      `  ${report.note}`,
      '',
    ].join('\n'),
  )
}

process.exit(verdict === 'NOT_RUN' ? 1 : 0)
