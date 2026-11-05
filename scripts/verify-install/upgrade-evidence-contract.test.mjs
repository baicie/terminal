import assert from 'node:assert/strict'
import test from 'node:test'
import { checkUpgradeReport } from './check-upgrade-evidence.mjs'
import {
  CONTRACT_VERSION,
  SCENARIO_CONTRACTS,
  deriveFaultOutcome,
} from './upgrade-evidence-contract.mjs'

function reportFor(scenario, overrides = {}) {
  const contract = SCENARIO_CONTRACTS[scenario]
  const checks = contract.requiredChecks.map(name => ({ name, status: 'PASS', detail: '' }))
  for (const [name, status] of Object.entries(contract.requiredCheckStatus || {})) {
    const existing = checks.find(check => check.name === name)
    if (existing) existing.status = status
    else checks.push({ name, status, detail: '' })
  }
  if (scenario === 'restore-backup') {
    checks.find(check => check.name === 'backup restore').detail =
      'A launched and read the restored pre-migration DB'
  }
  if (scenario === 'interrupted') {
    checks.find(check => check.name === 'interrupted mid-migration').detail =
      'committed agent_forwarding; missing shell_integration'
  }
  for (const name of ['B migration', 'data integrity after B', 'pre-migration backup']) {
    if (!checks.find(check => check.name === name)) {
      checks.push({
        name,
        status: name === 'pre-migration backup' && scenario.startsWith('linux-')
          ? 'NOT_RUN' : 'PASS',
        detail: '',
      })
    }
  }
  let faultAssessment
  if (contract.requiredFacts.length > 0) {
    const facts = Object.fromEntries(contract.requiredFacts.map(name => [name, 'PASS']))
    for (const name of ['APPLICATION_FAILURE_OBSERVED']) {
      if (!facts[name] && scenario === 'interrupted') facts[name] = 'NOT_RUN'
    }
    const derived = deriveFaultOutcome(scenario, facts)
    faultAssessment = { kind: scenario, ...derived }
    for (const name of derived.required) {
      checks.push({ name: 'fault.' + name, status: derived.facts[name], detail: '' })
    }
  }
  return {
    provider: 'upgrade-e2e',
    contractVersion: CONTRACT_VERSION,
    sourceSha: 'c'.repeat(40),
    runId: 'run-1',
    scenario,
    status: scenario === 'linux-appimage' ? 'PARTIAL' : 'PASS',
    platform: contract.platform,
    mode: scenario === 'linux-deb' ? 'deb' : scenario.startsWith('linux-appimage') ? 'appimage' : undefined,
    token: 'fixture-1',
    fault: scenario === 'normal' || scenario.startsWith('linux-') ? 'none' : scenario,
    expectBackup: ['normal', 'restore-backup', 'downgrade', 'interrupted', 'restart-idempotent'].includes(scenario),
    a: {
      version: '0.0.1-dev.1',
      installer: '/tmp/A.dmg',
      sha256: 'a'.repeat(64),
      identifier: 'com.baicie.termius',
      arch: 'arm64',
      status: 'PASS',
      problems: [],
      expected: { sha256: 'a'.repeat(64) },
    },
    b: {
      version: '0.0.1-dev.2',
      installer: '/tmp/B.dmg',
      sha256: 'b'.repeat(64),
      identifier: 'com.baicie.termius',
      arch: 'arm64',
      status: 'PASS',
      problems: [],
      expected: { sha256: 'b'.repeat(64) },
    },
    schema: {
      beforeHostColumns: ['id', 'name'],
      afterHostColumns: ['id', 'name', 'agent_forwarding'],
      addedHostColumns: ['agent_forwarding'],
    },
    checks,
    notRun: scenario === 'linux-appimage' ? ['AppImage app startup (headless EGL)'] : [],
    payloadOnly: scenario === 'linux-appimage',
    faultAssessment,
    ...overrides,
  }
}

test('accepts every version-2 scenario contract', () => {
  for (const scenario of Object.keys(SCENARIO_CONTRACTS)) {
    const value = reportFor(scenario)
    assert.equal(
      checkUpgradeReport(value, scenario, { requireContract: true }).status,
      value.status,
      scenario,
    )
  }
})

test('rejects a PASS report whose fault overall is PARTIAL', () => {
  const value = reportFor('interrupted')
  value.faultAssessment.overall = 'PARTIAL'
  value.faultAssessment.missing = ['APPLICATION_FAILURE_OBSERVED']
  assert.throws(
    () => checkUpgradeReport(value, 'interrupted', { requireContract: true }),
    /PASS while faultAssessment|differs from derived/,
  )
})

test('rejects missing required checks and facts', () => {
  const missingCheck = reportFor('interrupted')
  missingCheck.checks = missingCheck.checks.filter(check => check.name !== 'interrupted mid-migration')
  assert.throws(
    () => checkUpgradeReport(missingCheck, 'interrupted', { requireContract: true }),
    /missing required checks/,
  )

  const missingFact = reportFor('corrupt-db')
  delete missingFact.faultAssessment.facts.NO_PARTIAL_MIGRATION
  assert.throws(
    () => checkUpgradeReport(missingFact, 'corrupt-db', { requireContract: true }),
    /missing|differs|does not match/,
  )
})

test('restore-backup must prove A launched', () => {
  const value = reportFor('restore-backup')
  value.checks.find(check => check.name === 'backup restore').detail = 'copied file only'
  assert.throws(
    () => checkUpgradeReport(value, 'restore-backup', { requireContract: true }),
    /does not prove "A launched"/,
  )
})

test('downgrade must carry A identity and both downgrade checks', () => {
  const value = reportFor('downgrade')
  value.checks = value.checks.filter(check => check.name !== 'A metadata')
  assert.throws(
    () => checkUpgradeReport(value, 'downgrade', { requireContract: true }),
    /missing required checks/,
  )
})

test('restart-idempotent must prove the second launch', () => {
  const value = reportFor('restart-idempotent')
  value.checks = value.checks.filter(check => check.name !== 'restart idempotent')
  assert.throws(
    () => checkUpgradeReport(value, 'restart-idempotent', { requireContract: true }),
    /missing required checks/,
  )
})

test('interrupted must report the column missing at kill time', () => {
  const value = reportFor('interrupted')
  value.checks.find(check => check.name === 'interrupted mid-migration').detail = 'killed'
  assert.throws(
    () => checkUpgradeReport(value, 'interrupted', { requireContract: true }),
    /does not prove "missing"/,
  )
})

test('payload-only cannot claim startup or PASS', () => {
  const value = reportFor('linux-appimage')
  assert.throws(
    () => checkUpgradeReport({ ...value, status: 'PASS' }, 'appimage', { requireContract: true }),
    /payloadOnly cannot be PASS|payload-only scenario cannot be PASS/,
  )
  assert.throws(
    () => checkUpgradeReport({
      ...value,
      checks: value.checks.map(check =>
        check.name === 'AppImage app startup' ? { ...check, status: 'PASS' } : check),
    }, 'appimage', { requireContract: true }),
    /must (be|record app startup as) NOT_RUN/,
  )
})

test('full AppImage cannot be claimed with replacement only', () => {
  const value = reportFor('linux-appimage-full')
  value.checks = value.checks.filter(check => check.name !== 'AppImage app startup')
  assert.throws(
    () => checkUpgradeReport(value, 'appimage-full', { requireContract: true }),
    /missing required checks/,
  )
})

test('disk-full must prove blocked migration, preserved data, backup and recovery', () => {
  for (const name of [
    'disk-full migration blocked',
    'disk-full original data preserved',
    'disk-full backup readable',
    'disk-full recovery',
    'disk-full recovery data integrity',
  ]) {
    const value = reportFor('disk-full')
    value.checks = value.checks.filter(check => check.name !== name)
    assert.throws(
      () => checkUpgradeReport(value, 'disk-full', { requireContract: true }),
      /missing required checks/,
      name,
    )
  }
})

test('disk-full cannot convert failed recovery or partial migration into PASS', () => {
  for (const [fact, status] of [
    ['NO_PARTIAL_MIGRATION', 'FAIL'],
    ['RECOVERY_SUCCEEDED', 'FAIL'],
    ['RECOVERY_SUCCEEDED', 'NOT_RUN'],
    ['ORIGINAL_DATA_PRESERVED', 'FAIL'],
  ]) {
    const value = reportFor('disk-full')
    value.faultAssessment.facts[fact] = status
    assert.throws(
      () => checkUpgradeReport(value, 'disk-full', { requireContract: true }),
      /differs|failed facts|missing/,
      fact + '=' + status,
    )
  }
})

test('a PASS report cannot carry a FAIL check', () => {
  const value = reportFor('disk-full')
  value.checks.find(check => check.name === 'disk-full migration blocked').status = 'FAIL'
  assert.throws(
    () => checkUpgradeReport(value, 'disk-full', { requireContract: true }),
    /PASS while a check is FAIL|PASS with required FAIL facts/,
  )
})

test('rejects a report whose pinned SHA differs from the measured installer', () => {
  const value = reportFor('normal')
  value.a.expected.sha256 = 'c'.repeat(64)
  assert.throws(
    () => checkUpgradeReport(value, 'normal', { requireContract: true }),
    /expected sha256 differs/,
  )
})

test('a version-2 report is required when the CLI asks for the contract', () => {
  const value = reportFor('normal')
  delete value.contractVersion
  assert.throws(
    () => checkUpgradeReport(value, 'normal', { requireContract: true }),
    /does not declare contractVersion/,
  )
})

test('rejects a scenario label that hides a fault', () => {
  const value = reportFor('normal', { scenario: 'normal', fault: 'corrupt-db', contractVersion: 2 })
  assert.throws(
    () => checkUpgradeReport(value, 'spoofed', { requireContract: true }),
    /corrupt-db|missing required checks/,
  )
})

test('only allowlisted payload-only may be PARTIAL', () => {
  for (const status of ['FAIL', 'NOT_RUN', 'BLOCKED_EXTERNAL']) {
    assert.throws(
      () => checkUpgradeReport({ ...reportFor('normal'), status }, 'normal', { requireContract: true }),
      /is not valid for a green contract/,
    )
  }
  assert.throws(
    () => checkUpgradeReport({ ...reportFor('normal'), status: 'PARTIAL' }, 'normal', { requireContract: true }),
    /is not valid for a green contract/,
  )
})
