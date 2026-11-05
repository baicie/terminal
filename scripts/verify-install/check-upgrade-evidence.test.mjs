import assert from 'node:assert/strict'
import test from 'node:test'
import { checkUpgradeReport } from './check-upgrade-evidence.mjs'

function report(overrides = {}) {
  return {
    provider: 'upgrade-e2e',
    status: 'PASS',
    platform: 'darwin',
    token: 'fixture-1',
    fault: 'none',
    expectBackup: true,
    a: {
      version: '0.0.1-dev.1',
      sha256: 'a'.repeat(64),
      identifier: 'com.baicie.termius',
      arch: 'arm64',
    },
    b: {
      version: '0.0.1-dev.2',
      sha256: 'b'.repeat(64),
      identifier: 'com.baicie.termius',
      arch: 'arm64',
    },
    schema: {
      beforeHostColumns: ['id', 'name'],
      afterHostColumns: ['id', 'name', 'agent_forwarding'],
      addedHostColumns: ['agent_forwarding'],
    },
    checks: [
      { name: 'B migration', status: 'PASS' },
      { name: 'data integrity after B', status: 'PASS' },
      { name: 'pre-migration backup', status: 'PASS' },
    ],
    ...overrides,
  }
}

test('accepts a complete normal upgrade report', () => {
  assert.equal(checkUpgradeReport(report()).status, 'PASS')
})

test('rejects missing or malformed artifact identity', () => {
  assert.throws(
    () => checkUpgradeReport(report({ a: { ...report().a, sha256: 'not-a-sha' } })),
    /installer sha256/,
  )
  assert.throws(
    () => checkUpgradeReport(report({ b: { ...report().b, identifier: 'com.other' } })),
    /identifiers differ/,
  )
  assert.throws(
    () => checkUpgradeReport(report({ b: { ...report().b, version: report().a.version } })),
    /versions are identical/,
  )
})

test('rejects a report without data integrity or a required backup', () => {
  assert.throws(
    () =>
      checkUpgradeReport(
        report({
          checks: [
            { name: 'B migration', status: 'PASS' },
            { name: 'data integrity after B', status: 'NOT_RUN' },
            { name: 'pre-migration backup', status: 'PASS' },
          ],
        }),
      ),
    /data integrity after B/,
  )
  assert.throws(
    () =>
      checkUpgradeReport(
        report({
          checks: [
            { name: 'B migration', status: 'PASS' },
            { name: 'data integrity after B', status: 'PASS' },
            { name: 'pre-migration backup', status: 'NOT_RUN' },
          ],
        }),
      ),
    /expected a readable pre-migration backup/,
  )
})

test('accepts an AppImage PARTIAL with unverified internal version metadata', () => {
  const value = report({
    status: 'PARTIAL',
    expectBackup: false,
    a: {
      version: null,
      metadataSource: 'UNKNOWN',
      sha256: 'a'.repeat(64),
      identifier: null,
      arch: 'x64',
    },
    b: {
      version: null,
      metadataSource: 'UNKNOWN',
      sha256: 'b'.repeat(64),
      identifier: null,
      arch: 'x64',
    },
    checks: [
      { name: 'B migration', status: 'PASS' },
      { name: 'data integrity after B', status: 'PASS' },
      { name: 'pre-migration backup', status: 'NOT_RUN' },
    ],
  })
  assert.equal(checkUpgradeReport(value).status, 'PARTIAL')
  assert.throws(
    () => checkUpgradeReport({ ...value, status: 'PASS' }),
    /unverified metadata/,
  )
})

test('accepts a payload-only AppImage replacement without claiming startup', () => {
  const value = report({
    status: 'PARTIAL',
    mode: 'appimage',
    payloadOnly: true,
    schema: null,
    expectBackup: false,
    a: { version: null, metadataSource: 'UNKNOWN', sha256: 'a'.repeat(64), identifier: null, arch: 'x64' },
    b: { version: null, metadataSource: 'UNKNOWN', sha256: 'b'.repeat(64), identifier: null, arch: 'x64' },
    checks: [
      { name: 'AppImage payload replacement', status: 'PASS' },
      { name: 'AppImage app startup', status: 'NOT_RUN' },
    ],
  })
  assert.equal(checkUpgradeReport(value).status, 'PARTIAL')
  assert.throws(
    () => checkUpgradeReport({ ...value, checks: [{ name: 'AppImage app startup', status: 'NOT_RUN' }] }),
    /payload replacement/,
  )
})

test('rejects a fault report with a failed required fact', () => {
  assert.throws(
    () =>
      checkUpgradeReport(
        report({
          fault: 'read-only-data-dir',
          expectBackup: false,
          checks: [],
          faultAssessment: {
            kind: 'read-only-data-dir',
            overall: 'FAIL',
            required: ['ORIGINAL_DATA_PRESERVED'],
            failed: ['ORIGINAL_DATA_PRESERVED'],
            missing: [],
            facts: { ORIGINAL_DATA_PRESERVED: 'FAIL' },
          },
        }),
      ),
    /failed facts/,
  )
})

test('accepts a migration fault that has a complete faultAssessment', () => {
  const value = report({
    fault: 'corrupt-db',
    expectBackup: false,
    checks: [
      { name: 'fault.FAULT_INJECTED', status: 'PASS' },
      { name: 'fault.APPLICATION_FAILURE_OBSERVED', status: 'PASS' },
      { name: 'fault.ORIGINAL_DATA_PRESERVED', status: 'PASS' },
      { name: 'fault.NO_PARTIAL_MIGRATION', status: 'PASS' },
    ],
    faultAssessment: {
      kind: 'corrupt-db',
      overall: 'PASS',
      required: ['FAULT_INJECTED', 'APPLICATION_FAILURE_OBSERVED', 'ORIGINAL_DATA_PRESERVED', 'NO_PARTIAL_MIGRATION'],
      failed: [],
      missing: [],
      facts: {
        FAULT_INJECTED: 'PASS',
        APPLICATION_FAILURE_OBSERVED: 'PASS',
        ORIGINAL_DATA_PRESERVED: 'PASS',
        NO_PARTIAL_MIGRATION: 'PASS',
      },
    },
  })
  assert.equal(checkUpgradeReport(value).status, 'PASS')
})

test('rejects a fault report without its assessment', () => {
  assert.throws(
    () => checkUpgradeReport(report({ fault: 'corrupt-db', expectBackup: false, checks: [] })),
    /has no faultAssessment/,
  )
})
