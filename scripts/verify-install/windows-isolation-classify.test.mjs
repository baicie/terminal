import assert from 'node:assert/strict'
import test from 'node:test'
import { REASONS, classifyWindowsIsolation } from './windows-isolation-classify.mjs'

function evidence(overrides = {}) {
  return {
    evidenceComplete: true,
    currentSid: 'S-1-5-21-1-2-3-1002',
    expectedSid: 'S-1-5-21-1-2-3-1002',
    runnerSid: 'S-1-5-21-1-2-3-500',
    mode: 'dedicated-user',
    userProfile: 'C:\\Users\\termius-test',
    knownFolderRoaming: 'C:\\Users\\termius-test\\AppData\\Roaming',
    knownFolderLocal: 'C:\\Users\\termius-test\\AppData\\Local',
    targetData: 'C:\\Users\\termius-test\\AppData\\Roaming\\com.baicie.termius',
    targetVault: 'C:\\Users\\termius-test\\AppData\\Roaming\\terminal',
    targetLocal: 'C:\\Users\\termius-test\\AppData\\Local\\com.baicie.termius',
    targetInstall: 'C:\\Users\\termius-test\\AppData\\Local\\Termius',
    testRoot: 'C:\\Users\\termius-test',
    ownerSid: 'S-1-5-21-1-2-3-1002',
    reparsePoints: [],
    existingInstall: [],
    existingData: [],
    cleanupProbe: 'PASS',
    phase: 'pre-install',
    checks: [],
    ...overrides,
  }
}

test('accepts a verified one-time user', () => {
  const report = classifyWindowsIsolation(evidence())
  assert.equal(report.classification, 'ISOLATED_DEDICATED_USER')
  assert.equal(report.isolated, true)
  assert.equal(report.wouldTouchRealProfile, false)
})

test('refuses the shared runner identity', () => {
  const report = classifyWindowsIsolation(evidence({
    currentSid: 'S-1-5-21-1-2-3-500',
    expectedSid: 'S-1-5-21-1-2-3-500',
  }))
  assert.equal(report.reasonCode, REASONS.SHARED_RUNNER)
  assert.equal(report.isolated, false)
})

test('refuses missing or mismatched expected SID', () => {
  assert.equal(
    classifyWindowsIsolation(evidence({ expectedSid: '' })).reasonCode,
    REASONS.SID_MISMATCH,
  )
  assert.equal(
    classifyWindowsIsolation(evidence({ expectedSid: 'S-1-5-21-9-9-9-1003' })).reasonCode,
    REASONS.SID_MISMATCH,
  )
})

test('refuses redirected Known Folders', () => {
  const report = classifyWindowsIsolation(evidence({
    knownFolderRoaming: '\\\\server\\share\\Roaming',
  }))
  assert.equal(report.reasonCode, REASONS.FOLDER_REDIRECTED)
})

test('refuses reparse points and unsafe test roots', () => {
  assert.equal(
    classifyWindowsIsolation(evidence({ reparsePoints: ['C:\\Users\\termius-test\\data'] })).reasonCode,
    REASONS.REPARSE_POINT,
  )
  assert.equal(
    classifyWindowsIsolation(evidence({ testRoot: 'C:\\Users' })).reasonCode,
    REASONS.UNSAFE_TEST_ROOT,
  )
  assert.equal(
    classifyWindowsIsolation(evidence({ targetVault: 'C:\\Users\\runneradmin\\AppData\\Roaming\\terminal' })).reasonCode,
    REASONS.UNSAFE_TEST_ROOT,
  )
})

test('refuses wrong ownership, existing install/data and cleanup denial', () => {
  assert.equal(
    classifyWindowsIsolation(evidence({ ownerSid: 'S-1-5-21-1-2-3-1003' })).reasonCode,
    REASONS.OWNERSHIP,
  )
  assert.equal(
    classifyWindowsIsolation(evidence({ existingInstall: [{ displayName: 'Termius' }] })).reasonCode,
    REASONS.EXISTING_INSTALL,
  )
  assert.equal(
    classifyWindowsIsolation(evidence({ existingData: ['terminal.db'] })).reasonCode,
    REASONS.EXISTING_DATA,
  )
  assert.equal(
    classifyWindowsIsolation(evidence({ cleanupProbe: 'FAIL' })).reasonCode,
    REASONS.CLEANUP_PERMISSION,
  )
})

test('requires run-bound VM attestation for disposable-vm mode', () => {
  assert.equal(
    classifyWindowsIsolation(evidence({ mode: 'disposable-vm' })).reasonCode,
    REASONS.VM_ATTESTATION,
  )
  const report = classifyWindowsIsolation(evidence({
    mode: 'disposable-vm',
    runId: 'run-1',
    vmAttestation: { runId: 'run-1', instanceId: 'i-1', imageId: 'img-1' },
  }))
  assert.equal(report.classification, 'ISOLATED_DISPOSABLE_VM')
  assert.equal(report.isolated, true)
})

test('refuses incomplete evidence', () => {
  assert.equal(
    classifyWindowsIsolation(evidence({ evidenceComplete: false })).reasonCode,
    REASONS.EVIDENCE_INCOMPLETE,
  )
  assert.equal(
    classifyWindowsIsolation(evidence({ userProfile: '' })).reasonCode,
    REASONS.EVIDENCE_INCOMPLETE,
  )
})
