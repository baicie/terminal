#!/usr/bin/env node
/**
 * Independent fail-closed gate for upgrade evidence.
 *
 * This is deliberately separate from the six cold-start/SSH evidence files:
 * the upgrade harness is new and must not invalidate those fingerprints. The
 * gate checks the upgrade report itself: both artifacts' hashes and identities,
 * the fixture, schema transition, data-domain checks, backup, and any fault
 * sub-facts. Missing or contradictory fields fail; a fault that only preserved
 * the database without the intended facts fails.
 *
 * Usage:
 *   node scripts/verify-install/check-upgrade-evidence.mjs <report.json>...
 * Exit: 0 all reports valid, 1 invalid, 2 usage.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SHA256 = /^[a-f0-9]{64}$/
const STATUSES = new Set(['PASS', 'PARTIAL', 'FAIL', 'NOT_RUN'])
const VALID_CHECK = new Set(['PASS', 'FAIL', 'NOT_RUN'])

function fail(message) {
  throw new Error(message)
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function checkUpgradeReport(report, label = 'upgrade-report.json') {
  if (!isObject(report)) fail(label + ' is not an object')
  if (report.provider !== 'upgrade-e2e') fail(label + ' has no upgrade-e2e provider')
  if (!STATUSES.has(report.status)) fail(label + ' has an invalid status: ' + report.status)
  if (typeof report.platform !== 'string' || report.platform.length === 0) fail(label + ' has no platform')
  if (typeof report.token !== 'string' || report.token.length === 0) fail(label + ' has no fixture token')

  const unverifiedMetadata = []
  for (const side of ['a', 'b']) {
    const artifact = report[side]
    if (!isObject(artifact)) fail(label + ' has no ' + side + ' artifact')
    if (typeof artifact.version !== 'string' || artifact.version.length === 0) {
      if (artifact.metadataSource !== 'UNKNOWN') {
        fail(label + ' ' + side + ' has no version and does not declare UNKNOWN metadata')
      }
      unverifiedMetadata.push(side)
    }
    if (typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)) {
      fail(label + ' ' + side + ' has no 64-hex installer sha256')
    }
    if (
      artifact.identifier !== null &&
      (typeof artifact.identifier !== 'string' || artifact.identifier.length === 0)
    ) {
      fail(label + ' ' + side + ' has a malformed identifier')
    }
    if (typeof artifact.arch !== 'string' || artifact.arch.length === 0) {
      fail(label + ' ' + side + ' has no architecture')
    }
  }
  if (unverifiedMetadata.length > 0 && report.status === 'PASS') {
    fail(label + ' is PASS with unverified metadata on ' + unverifiedMetadata.join(','))
  }
  if (report.a.identifier !== report.b.identifier) {
    fail(label + ' A/B identifiers differ: ' + report.a.identifier + ' / ' + report.b.identifier)
  }
  if (report.a.version === report.b.version) {
    fail(label + ' A/B versions are identical: ' + report.a.version)
  }

  const migrationFaults = new Set(['corrupt-db', 'read-only-data-dir'])
  const faultAssessmentModes = new Set([
    'corrupt-db',
    'read-only-data-dir',
    'restart-idempotent',
    'interrupted',
  ])
  if (!isObject(report.schema)) fail(label + ' has no schema transition')
  const before = report.schema.beforeHostColumns
  const after = report.schema.afterHostColumns
  if (!migrationFaults.has(report.fault)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      fail(label + ' schema before/after host columns must be arrays')
    }
    const added = after.filter(column => !before.includes(column))
    const declared = Array.isArray(report.schema.addedHostColumns)
      ? report.schema.addedHostColumns
      : []
    if (declared.length > 0 && added.join(',') !== declared.join(',')) {
      fail(label + ' schema added columns contradict the before/after sets')
    }
  }

  if (!Array.isArray(report.checks)) fail(label + ' has no checks array')
  const names = new Set()
  for (const check of report.checks) {
    if (!isObject(check) || typeof check.name !== 'string' || check.name.length === 0) {
      fail(label + ' has a malformed check')
    }
    if (!VALID_CHECK.has(check.status)) {
      fail(label + ' check ' + check.name + ' has an invalid status: ' + check.status)
    }
    if (names.has(check.name)) fail(label + ' has a duplicate check: ' + check.name)
    names.add(check.name)
  }
  const byName = new Map(report.checks.map(check => [check.name, check.status]))
  if (!migrationFaults.has(report.fault)) {
    if (byName.get('data integrity after B') !== 'PASS') {
      fail(label + ' does not prove data integrity after B')
    }
    if (byName.get('B migration') !== 'PASS') fail(label + ' does not prove the B migration')
  }
  if (!migrationFaults.has(report.fault)) {
    const backup = byName.get('pre-migration backup')
    if (backup !== 'PASS' && backup !== 'NOT_RUN') {
      fail(label + ' has no backup result')
    }
    if (report.expectBackup === true && backup !== 'PASS') {
      fail(label + ' expected a readable pre-migration backup but got ' + backup)
    }
  }

  if (report.faultAssessment) {
    const fault = report.faultAssessment
    if (!isObject(fault) || !Array.isArray(fault.required) || !Array.isArray(fault.failed)) {
      fail(label + ' has a malformed faultAssessment')
    }
    if (fault.failed.length > 0) fail(label + ' fault has failed facts: ' + fault.failed.join(','))
    if (fault.overall === 'FAIL') fail(label + ' fault overall is FAIL')
    if (fault.overall === 'PARTIAL') {
      // Partial is allowed only when the missing fact is listed; the report
      // must not silently claim PASS.
      if (!Array.isArray(fault.missing) || fault.missing.length === 0) {
        fail(label + ' fault PARTIAL has no missing fact list')
      }
    }
    for (const name of fault.required) {
      const status = fault.facts ? fault.facts[name] : undefined
      if (status === 'FAIL') fail(label + ' fault fact ' + name + ' is FAIL')
    }
  } else if (faultAssessmentModes.has(report.fault)) {
    fail(label + ' fault ' + report.fault + ' has no faultAssessment')
  }

  if (report.status === 'PASS' && report.checks.some(check => check.status === 'FAIL')) {
    fail(label + ' is PASS while a check is FAIL')
  }
  return {
    status: report.status,
    a: report.a.version + ' ' + report.a.sha256.slice(0, 16),
    b: report.b.version + ' ' + report.b.sha256.slice(0, 16),
    checks: report.checks.length,
  }
}

function main(argv) {
  const files = argv.filter(argument => !argument.startsWith('--'))
  if (files.length === 0) {
    console.error('usage: check-upgrade-evidence.mjs <report.json>...')
    process.exit(2)
  }
  let failed = 0
  for (const file of files) {
    const absolute = path.resolve(file)
    if (!existsSync(absolute)) {
      console.error('[FAIL] missing report: ' + absolute)
      failed += 1
      continue
    }
    try {
      const report = JSON.parse(readFileSync(absolute, 'utf8'))
      const summary = checkUpgradeReport(report, absolute)
      console.log('[PASS] ' + absolute + ' ' + JSON.stringify(summary))
    } catch (error) {
      console.error('[FAIL] ' + absolute + ': ' + (error instanceof Error ? error.message : String(error)))
      failed += 1
    }
  }
  if (failed > 0) process.exit(1)
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) main(process.argv.slice(2))
