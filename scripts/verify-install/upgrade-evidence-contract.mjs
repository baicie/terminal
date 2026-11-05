/**
 * Scenario-level contract for upgrade evidence.
 *
 * A check name being present is not enough: every scenario has a different
 * definition of "the upgrade actually happened". This module keeps that
 * definition declarative so the gate and the negative tests use the same
 * source of truth.
 */

export const CONTRACT_VERSION = 2

export const SCENARIO_CONTRACTS = {
  normal: {
    platform: 'darwin',
    requiredChecks: [
      'A metadata',
      'B metadata',
      'install A',
      'A database created',
      'A schema ready',
      'A stopped',
      'seed A data',
      'A read-back snapshot',
      'install B',
      'B migration',
      'B stopped',
      'data integrity after B',
      'vault crypto unlock after B',
    ],
    requiredFacts: [],
  },
  'corrupt-db': {
    platform: 'darwin',
    requiredChecks: ['corrupt DB preserved', 'corruption detected by the app'],
    requiredFacts: [
      'FAULT_INJECTED',
      'APPLICATION_FAILURE_OBSERVED',
      'ORIGINAL_DATA_PRESERVED',
      'NO_PARTIAL_MIGRATION',
    ],
  },
  'read-only-data-dir': {
    platform: 'darwin',
    requiredChecks: [
      'read-only data dir preserved DB',
      'read-only failure detected by the app',
      'no partial migration',
      'read-only recovery',
      'read-only recovery data integrity',
    ],
    requiredFacts: [
      'FAULT_INJECTED',
      'APPLICATION_FAILURE_OBSERVED',
      'ORIGINAL_DATA_PRESERVED',
      'NO_PARTIAL_MIGRATION',
      'RECOVERY_SUCCEEDED',
    ],
  },
  'restart-idempotent': {
    platform: 'darwin',
    requiredChecks: ['B migration', 'second B launch', 'restart idempotent', 'data integrity after B', 'pre-migration backup'],
    requiredFacts: ['ORIGINAL_DATA_PRESERVED', 'NO_PARTIAL_MIGRATION', 'RECOVERY_SUCCEEDED'],
  },
  interrupted: {
    platform: 'darwin',
    requiredChecks: [
      'interrupted after backup',
      'interrupted mid-migration',
      'pre-migration backup',
      'B migration',
      'data integrity after B',
      'interrupted migration recovery',
    ],
    requiredFacts: [
      'FAULT_INJECTED',
      'ORIGINAL_DATA_PRESERVED',
      'NO_PARTIAL_MIGRATION',
      'RECOVERY_SUCCEEDED',
    ],
    requiredDetail: {
      'interrupted mid-migration': 'missing',
    },
  },
  'disk-full': {
    platform: 'darwin',
    requiredChecks: [
      'disk-full migration blocked',
      'disk-full original data preserved',
      'disk-full backup readable',
      'disk-full recovery',
      'disk-full recovery data integrity',
    ],
    requiredFacts: [
      'FAULT_INJECTED',
      'APPLICATION_FAILURE_OBSERVED',
      'ORIGINAL_DATA_PRESERVED',
      'NO_PARTIAL_MIGRATION',
      'RECOVERY_SUCCEEDED',
    ],
  },
  'restore-backup': {
    platform: 'darwin',
    requiredChecks: [
      'B migration',
      'data integrity after B',
      'backup readable',
      'restored DB matches backup',
      'restored A launch',
      'backup restore',
      'backup restore stages',
      'pre-migration backup',
    ],
    requiredFacts: [],
    requiredDetail: {
      'backup restore': 'A launched',
    },
  },
  downgrade: {
    platform: 'darwin',
    requiredChecks: [
      'A metadata',
      'downgrade A launch',
      'downgrade readability',
      'downgrade preserved B columns',
      'downgrade did not destroy data',
    ],
    requiredFacts: [],
  },
  'linux-deb': {
    platform: 'linux',
    requiredChecks: [
      'A metadata',
      'B metadata',
      'install A (deb)',
      'A database created',
      'A schema ready',
      'A stopped',
      'seed A data',
      'A read-back snapshot',
      'B installed version',
      'A->B version changed',
      'B migration',
      'B stopped',
      'data integrity after B',
    ],
    requiredFacts: [],
  },
  'linux-appimage': {
    platform: 'linux',
    requiredChecks: ['AppImage payload replacement'],
    requiredFacts: [],
    requiredCheckStatus: {
      'AppImage payload replacement': 'PASS',
      'AppImage app startup': 'NOT_RUN',
    },
    payloadOnly: true,
    allowPartial: true,
  },
  'linux-appimage-full': {
    platform: 'linux',
    requiredChecks: [
      'AppImage payload replacement',
      'AppImage app startup',
      'B migration',
      'data integrity after B',
    ],
    requiredFacts: [],
  },
}

export function resolveScenario(report) {
  // Never trust report.scenario: it must agree with the observable fault/mode.
  if (report.payloadOnly === true) return 'linux-appimage'
  if (report.platform === 'linux' && report.mode === 'deb') return 'linux-deb'
  if (report.platform === 'linux' && report.mode === 'appimage') return 'linux-appimage-full'
  if (report.fault === 'none' || report.fault === undefined) return 'normal'
  return report.fault
}

export function statusOfChecks(checks, required) {
  const byName = new Map((checks || []).map(check => [check.name, check.status]))
  const missing = []
  const notRun = []
  const failed = []
  for (const name of required) {
    const status = byName.get(name)
    if (status === undefined) missing.push(name)
    else if (status === 'NOT_RUN') notRun.push(name)
    else if (status === 'FAIL') failed.push(name)
  }
  return { byName, missing, notRun, failed }
}

export function deriveFaultOutcome(kind, facts) {
  const contract = SCENARIO_CONTRACTS[kind]
  if (!contract) throw new Error('unknown scenario: ' + kind)
  const required = contract.requiredFacts
  const normalized = {}
  for (const name of required) {
    const value = facts && facts[name] !== undefined ? facts[name] : 'NOT_RUN'
    if (!['PASS', 'FAIL', 'NOT_RUN'].includes(value)) {
      throw new Error('invalid fault fact ' + name + ': ' + String(value))
    }
    normalized[name] = value
  }
  const failed = required.filter(name => normalized[name] === 'FAIL')
  const missing = required.filter(name => normalized[name] === 'NOT_RUN')
  const overall = failed.length > 0 ? 'FAIL' : missing.length > 0 ? 'PARTIAL' : 'PASS'
  return { required, failed, missing, overall, facts: normalized }
}

export function validateScenarioContract(report, label) {
  const scenario = resolveScenario(report)
  const contract = SCENARIO_CONTRACTS[scenario]
  if (!contract) {
    throw new Error(label + ' has an unknown scenario: ' + scenario)
  }
  if (typeof report.scenario === 'string' && report.scenario !== scenario) {
    throw new Error(label + ' report.scenario ' + report.scenario +
      ' contradicts the observable scenario ' + scenario)
  }
  if (report.platform !== contract.platform) {
    throw new Error(label + ' scenario ' + scenario + ' requires platform ' + contract.platform)
  }
  if (report.status === 'PASS' && report.faultAssessment && report.faultAssessment.overall !== 'PASS') {
    throw new Error(label + ' is PASS while faultAssessment.overall is ' + report.faultAssessment.overall)
  }
  const checkState = statusOfChecks(report.checks, contract.requiredChecks)
  if (checkState.missing.length > 0) {
    throw new Error(label + ' is missing required checks: ' + checkState.missing.join(','))
  }
  // A backup is required only when the report claims one is expected. The
  // historical dev.1 -> dev.2 pair predates the snapshot feature and records
  // NOT_RUN, which must not be read as a green backup.
  if (report.expectBackup === true) {
    const backup = checkState.byName.get('pre-migration backup')
    if (backup !== 'PASS') {
      throw new Error(label + ' expects a readable pre-migration backup but got ' + (backup ?? 'missing'))
    }
  }
  for (const [name, expected] of Object.entries(contract.requiredCheckStatus || {})) {
    if (checkState.byName.get(name) !== expected) {
      throw new Error(label + ' check ' + name + ' must be ' + expected)
    }
  }
  for (const [name, text] of Object.entries(contract.requiredDetail || {})) {
    const check = report.checks.find(item => item.name === name)
    if (!check || typeof check.detail !== 'string' || !check.detail.includes(text)) {
      throw new Error(label + ' check ' + name + ' does not prove "' + text + '"')
    }
  }

  let fault = null
  if (contract.requiredFacts.length > 0) {
    if (!report.faultAssessment) {
      throw new Error(label + ' scenario ' + scenario + ' has no faultAssessment')
    }
    fault = deriveFaultOutcome(scenario, report.faultAssessment.facts)
    const declared = report.faultAssessment
    if (declared.kind !== scenario) {
      throw new Error(label + ' faultAssessment.kind does not match scenario ' + scenario)
    }
    const same = (left, right) => left.length === right.length && left.every(value => right.includes(value))
    if (!same(declared.required || [], fault.required)) {
      throw new Error(label + ' faultAssessment.required differs from the scenario contract')
    }
    if (!same(declared.failed || [], fault.failed)) {
      throw new Error(label + ' faultAssessment.failed differs from derived facts')
    }
    if (!same(declared.missing || [], fault.missing)) {
      throw new Error(label + ' faultAssessment.missing differs from derived facts')
    }
    if (declared.overall !== fault.overall) {
      throw new Error(label + ' faultAssessment.overall differs from derived facts')
    }
    for (const name of fault.required) {
      const check = report.checks.find(item => item.name === 'fault.' + name)
      if (!check || check.status !== fault.facts[name]) {
        throw new Error(label + ' fault.' + name + ' check does not match faultAssessment.facts')
      }
    }
  } else if (report.faultAssessment) {
    throw new Error(label + ' scenario ' + scenario + ' must not have faultAssessment')
  }

  const requiredNotPass = [
    ...checkState.notRun,
    ...(fault ? fault.missing : []),
  ]
  const requiredFailed = [
    ...checkState.failed,
    ...(fault ? fault.failed : []),
  ]
  for (const [name, expected] of Object.entries(contract.requiredCheckStatus || {})) {
    if (expected === 'NOT_RUN') requiredNotPass.push(name)
    if (expected === 'FAIL') requiredFailed.push(name)
  }
  if (report.status === 'PASS') {
    if (contract.payloadOnly) throw new Error(label + ' payload-only scenario cannot be PASS')
    if (requiredNotPass.length > 0) {
      throw new Error(label + ' is PASS with required NOT_RUN facts: ' + requiredNotPass.join(','))
    }
    if (requiredFailed.length > 0) {
      throw new Error(label + ' is PASS with required FAIL facts: ' + requiredFailed.join(','))
    }
    if (fault && fault.overall !== 'PASS') {
      throw new Error(label + ' is PASS while fault overall is ' + fault.overall)
    }
  } else if (report.status === 'PARTIAL' && contract.allowPartial === true) {
    if (requiredNotPass.length === 0) {
      throw new Error(label + ' is PARTIAL but records no missing required fact')
    }
    if (!Array.isArray(report.notRun) || report.notRun.length === 0) {
      throw new Error(label + ' is PARTIAL but has no notRun list')
    }
  } else {
    // FAIL, NOT_RUN and BLOCKED_EXTERNAL are evidence outcomes, not green
    // evidence. Only an explicitly allowlisted scenario may be PARTIAL.
    throw new Error(label + ' status ' + report.status +
      ' is not valid for a green contract (only PASS or an allowlisted PARTIAL)')
  }
}
