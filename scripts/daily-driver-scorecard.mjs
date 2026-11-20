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
 * ## The three verdicts, and why they are three
 *
 * An earlier version had one axis — "did the week have enough sessions?" — and that
 * conflated two questions a reader must keep apart:
 *
 *   `DATA_COVERAGE`        Is there enough recorded use to describe a week at all?
 *   `AUTOMATED_ACCEPTANCE` Do the automated suites pass? (not measured here — this
 *                          tool reads usage, not tests; see the note it prints)
 *   `MANUAL_7DAY_ACCEPTANCE` Did a person actually use it for seven days and find it
 *                          good? This tool can never answer that.
 *
 * The single `MEASURED` label used to imply the last one. It does not: `MEASURED` means
 * the *counts* are sufficient to be read, nothing more. `--json` emits all three
 * explicitly so a downstream reader cannot make that mistake on this tool's behalf.
 *
 * ## Why it refuses to grade bad input
 *
 * `--days abc` used to become `NaN`, which made the window empty, which produced
 * `NOT_RUN` — indistinguishable from "the user did not use the app", and with the same
 * exit code. A mistyped flag could therefore quietly report a week as not having
 * happened. Invalid input is now a distinct failure (exit 2) with the value named.
 *
 *   node scripts/daily-driver-scorecard.mjs [--db <path>] [--days 7] [--json]
 *
 * Exit codes:
 *   0  the window has enough data to read (`MEASURED` or `PARTIAL`)
 *   1  the window has no recorded use (`NOT_RUN`)
 *   2  the arguments or the database are unusable — a tool problem, not a usage fact
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
export const THRESHOLDS = {
  /** Days with at least one session. A 7-day scorecard with 3 active days is not a week of use. */
  activeDays: 5,
  /** Sessions per active day, below which the sample is too thin to describe habits. */
  sessionsPerActiveDay: 2,
}

/** The widest window this tool will look at. */
export const MAX_DAYS = 365

/**
 * Parse `--days`, or explain why the value cannot be used.
 *
 * Split out and exported so the rules are testable without a database — the previous
 * version inlined `Number(flag('--days') ?? 7)` and every invalid value became `NaN`,
 * which is `false`-y in comparisons and produced an empty query window.
 */
export function parseDays(raw) {
  if (raw === undefined) return { ok: true, days: 7 }
  const text = String(raw).trim()
  if (text === '') return { ok: false, reason: '--days needs a number, got an empty value' }
  const value = Number(text)
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `--days needs a finite number, got ${JSON.stringify(text)}` }
  }
  if (!Number.isInteger(value)) {
    return { ok: false, reason: `--days needs a whole number of days, got ${JSON.stringify(text)}` }
  }
  if (value < 1) {
    return { ok: false, reason: `--days must be at least 1, got ${value}` }
  }
  if (value > MAX_DAYS) {
    return { ok: false, reason: `--days must be at most ${MAX_DAYS}, got ${value}` }
  }
  return { ok: true, days: value }
}

/**
 * The local calendar day a timestamp falls on.
 *
 * ## Why not `toISOString().slice(0, 10)`
 *
 * That is the UTC date. A session at 23:30 local time in UTC+8 is 15:30 UTC on the
 * *same* day, so it is fine — but a session at 01:00 local is 17:00 UTC on the
 * *previous* day. Two sessions in one local evening could therefore count as one day on
 * one side of midnight and two on the other, which changes `activeDays` and with it the
 * verdict.
 *
 * The question the scorecard asks is "did the user work on this day", and a person's
 * day is local. Built from the local getters so the answer does not depend on the
 * machine's UTC offset.
 */
export function localDayKey(ms) {
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Median of a numeric list, or null when empty. */
export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]
    : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
}

/**
 * The report from rows already read.
 *
 * Pure, so every branch is testable with a literal fixture — including the ones that
 * need many months of data or a specific timezone, which a live database cannot supply
 * on demand.
 */
export function buildReport({ rows, days, dbPath }) {
  /*
   * ## Duplicate suppression
   *
   * The connection log is written once per connection *attempt* on some paths and once
   * per session on others. Two rows with the same `started_at` and host within the same
   * second are one session recorded twice, not two sessions: counting them would
   * inflate `sessionsPerActiveDay` and turn a thin week into a passing one.
   */
  const seen = new Set()
  const unique = rows.filter(row => {
    const key = `${row.host_name}|${row.started_at}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const activeDays = new Set(unique.map(row => localDayKey(row.started_at)))
  const byType = unique.reduce((acc, row) => {
    acc[row.connection_type] = (acc[row.connection_type] ?? 0) + 1
    return acc
  }, {})
  const failures = unique.filter(row => row.error_message)
  const durations = unique
    .map(row => row.duration_seconds)
    .filter(value => typeof value === 'number' && value > 0)

  const sessionsPerActiveDay =
    activeDays.size === 0 ? 0 : Math.round((unique.length / activeDays.size) * 10) / 10

  /*
   * `DATA_COVERAGE` is the only axis this tool measures.
   *
   * `NOT_RUN` is not a failure of the product — it says the week did not happen, which
   * is what an empty or thin window means. `PARTIAL` says it happened but not enough to
   * describe a week. Only a window that clears both thresholds is graded at all.
   */
  const dataCoverage =
    unique.length === 0
      ? 'NOT_RUN'
      : activeDays.size < THRESHOLDS.activeDays ||
          sessionsPerActiveDay < THRESHOLDS.sessionsPerActiveDay
        ? 'PARTIAL'
        : 'MEASURED'

  return {
    windowDays: days,
    database: dbPath,
    sessions: unique.length,
    /** Rows the query returned before duplicate suppression; a difference is worth seeing. */
    rawRows: rows.length,
    activeDays: activeDays.size,
    sessionsPerActiveDay,
    byType,
    failures: failures.length,
    failureRate:
      unique.length === 0 ? null : Math.round((failures.length / unique.length) * 1000) / 10,
    medianDurationSeconds: median(durations),
    thresholds: THRESHOLDS,
    /*
     * The three states, named so a reader cannot collapse them.
     *
     * Only the first is measured here. The other two are stated as what they are —
     * `NOT_MEASURED` and `NOT_MEASURED` — rather than being reported as passing because
     * this tool happened to exit 0.
     */
    verdicts: {
      dataCoverage,
      automatedAcceptance: {
        state: 'NOT_MEASURED',
        why: 'this tool reads usage records; the automated suites are CI, not this script',
      },
      manual7DayAcceptance: {
        state: 'NOT_MEASURED',
        why: 'whether a week of use was *good* is a person reading these counts, plus the observations in docs/design/terminal-next/15-daily-driver-matrix.md §2',
      },
    },
    note:
      dataCoverage === 'MEASURED'
        ? 'Counts only. MEASURED means the data is sufficient to read — not that the product is ready, and not that anyone found it good.'
        : 'Not enough real use in this window to describe a week. This is not a pass.',
  }
}

/** Exit code for a completed report. */
export function exitCodeFor(dataCoverage) {
  return dataCoverage === 'NOT_RUN' ? 1 : 0
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** True when this module was run directly rather than imported by a test. */
const isMain =
  process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`

if (isMain) {
  const argv = process.argv.slice(2)
  const flag = name => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const parsedDays = parseDays(flag('--days'))
  if (!parsedDays.ok) {
    // Exit 2, not 1: a bad flag is a problem with the tool's input, and reporting it
    // with the same code as "no usage" is how a typo became a business conclusion.
    console.error(`${parsedDays.reason}\n`)
    console.error('usage: node scripts/daily-driver-scorecard.mjs [--db <path>] [--days N] [--json]')
    process.exit(2)
  }
  const days = parsedDays.days
  const dbPath = flag('--db') ?? defaultDatabasePath()
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

  const report = buildReport({ rows, days, dbPath })

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    const { dataCoverage } = report.verdicts
    process.stdout.write(
      [
        `Daily Driver scorecard — last ${days} days`,
        `  database      ${dbPath}`,
        `  sessions      ${report.sessions}` +
          (report.rawRows === report.sessions ? '' : ` (${report.rawRows} rows, duplicates dropped)`) +
          ` (${report.activeDays} active days, ${report.sessionsPerActiveDay}/day)`,
        `  by type       ${JSON.stringify(report.byType)}`,
        `  failures      ${report.failures} (${report.failureRate ?? '—'}%)`,
        `  median        ${report.medianDurationSeconds ?? '—'}s`,
        `  data coverage ${dataCoverage}`,
        '',
        '  Automated acceptance  NOT_MEASURED — CI, not this script',
        '  7-day acceptance      NOT_MEASURED — a person reads these counts',
        '',
        `  ${report.note}`,
        '',
      ].join('\n'),
    )
  }

  process.exit(exitCodeFor(report.verdicts.dataCoverage))
}
