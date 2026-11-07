/**
 * Fault-scenario assessment.
 *
 * "The database SHA did not change" is necessary but not sufficient: a test
 * must also show that the fault was actually injected, that the application
 * noticed it, that no partial migration happened, and (where the product
 * supports it) that a restart recovered. Keeping the five facts separate stops
 * a missing error log or a missing recovery step from being folded into a
 * single green result.
 */

export const FAULT_FACTS = [
  'FAULT_INJECTED',
  'APPLICATION_FAILURE_OBSERVED',
  'ORIGINAL_DATA_PRESERVED',
  'NO_PARTIAL_MIGRATION',
  'RECOVERY_SUCCEEDED',
]

export const REQUIRED_FACTS = {
  'corrupt-db': [
    'FAULT_INJECTED',
    'APPLICATION_FAILURE_OBSERVED',
    'ORIGINAL_DATA_PRESERVED',
    'NO_PARTIAL_MIGRATION',
  ],
  'read-only-data-dir': [
    'FAULT_INJECTED',
    'APPLICATION_FAILURE_OBSERVED',
    'ORIGINAL_DATA_PRESERVED',
    'NO_PARTIAL_MIGRATION',
    'RECOVERY_SUCCEEDED',
  ],
  'restart-idempotent': [
    'ORIGINAL_DATA_PRESERVED',
    'NO_PARTIAL_MIGRATION',
    'RECOVERY_SUCCEEDED',
  ],
  'disk-full': [
    'FAULT_INJECTED',
    'APPLICATION_FAILURE_OBSERVED',
    'ORIGINAL_DATA_PRESERVED',
    'NO_PARTIAL_MIGRATION',
    'RECOVERY_SUCCEEDED',
  ],
  interrupted: [
    'FAULT_INJECTED',
    'ORIGINAL_DATA_PRESERVED',
    'NO_PARTIAL_MIGRATION',
    'RECOVERY_SUCCEEDED',
  ],
  'team-interrupted': [
    'FAULT_INJECTED',
    'ORIGINAL_DATA_PRESERVED',
    'NO_PARTIAL_MIGRATION',
    'RECOVERY_SUCCEEDED',
  ],
}

const VALID = new Set(['PASS', 'FAIL', 'NOT_RUN'])

/**
 * @param {string} kind
 * @param {Record<string, 'PASS'|'FAIL'|'NOT_RUN'>} facts
 * @returns {{overall:string, required:string[], failed:string[], missing:string[], facts:Record<string,string>}}
 */
export function assessFault(kind, facts) {
  const required = REQUIRED_FACTS[kind]
  if (!required) {
    throw new Error('unknown fault kind: ' + kind)
  }
  const normalized = {}
  for (const name of FAULT_FACTS) {
    const value = facts[name] ?? 'NOT_RUN'
    if (!VALID.has(value)) {
      throw new Error('invalid ' + name + ' status: ' + String(value))
    }
    normalized[name] = value
  }
  const failed = required.filter(name => normalized[name] === 'FAIL')
  const missing = required.filter(name => normalized[name] === 'NOT_RUN')
  const overall = failed.length > 0 ? 'FAIL' : missing.length > 0 ? 'PARTIAL' : 'PASS'
  return { overall, required, failed, missing, facts: normalized }
}
