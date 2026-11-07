#!/usr/bin/env node
/**
 * Pure Windows isolation classifier.
 *
 * Path containment alone cannot distinguish the shared runner profile from a
 * dedicated one-time user. This module makes the decision explicit and
 * testable; the PowerShell preflight only collects evidence.
 *
 * Usage:
 *   node windows-isolation-classify.mjs --evidence <json> --out <json>
 * Exit: 0 isolated, 1 refused, 2 malformed evidence.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const REASONS = {
  EVIDENCE_INCOMPLETE: 'REFUSED_EVIDENCE_INCOMPLETE',
  SID_MISMATCH: 'REFUSED_SID_MISMATCH',
  SHARED_RUNNER: 'REFUSED_SHARED_RUNNER_PROFILE',
  UNKNOWN_IDENTITY: 'REFUSED_UNKNOWN_IDENTITY',
  UNSAFE_TEST_ROOT: 'REFUSED_UNSAFE_TEST_ROOT',
  REPARSE_POINT: 'REFUSED_REPARSE_POINT',
  FOLDER_REDIRECTED: 'REFUSED_FOLDER_REDIRECTED',
  OWNERSHIP: 'REFUSED_OWNERSHIP',
  CLEANUP_PERMISSION: 'REFUSED_CLEANUP_PERMISSION',
  EXISTING_INSTALL: 'REFUSED_EXISTING_INSTALL',
  EXISTING_DATA: 'REFUSED_EXISTING_DATA',
  VM_ATTESTATION: 'REFUSED_VM_ATTESTATION',
  UNSAFE_OUTFILE: 'REFUSED_UNSAFE_OUTFILE',
}

const SYSTEM_SIDS = new Set(['S-1-5-18', 'S-1-5-19', 'S-1-5-20'])

function normalize(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()
}

function under(child, parent) {
  const c = normalize(child)
  const p = normalize(parent)
  if (!c || !p) return false
  return c === p || c.startsWith(p + '\\')
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function refuse(reasonCode, detail, evidence) {
  return {
    provider: 'windows-isolation-classifier',
    classification: 'REFUSED',
    isolated: false,
    wouldTouchRealProfile: true,
    reasonCode,
    reasonDetail: detail,
    evidenceComplete: evidence?.evidenceComplete === true,
    readOnlyPreflight: true,
    checks: evidence?.checks || [],
  }
}

export function classifyWindowsIsolation(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return refuse(REASONS.EVIDENCE_INCOMPLETE, 'no evidence object', null)
  }
  if (evidence.evidenceComplete !== true) {
    return refuse(REASONS.EVIDENCE_INCOMPLETE, 'collector reported incomplete evidence', evidence)
  }
  const required = [
    'currentSid',
    'userProfile',
    'knownFolderRoaming',
    'knownFolderLocal',
    'targetData',
    'targetVault',
    'targetLocal',
    'testRoot',
    'ownerSid',
    'mode',
  ]
  const missing = required.filter(name => !nonEmpty(evidence[name]))
  if (missing.length > 0) {
    return refuse(REASONS.EVIDENCE_INCOMPLETE, 'missing fields: ' + missing.join(','), evidence)
  }

  const expectedSid = typeof evidence.expectedSid === 'string' ? evidence.expectedSid : ''
  const runnerSid = typeof evidence.runnerSid === 'string' ? evidence.runnerSid : ''
  const currentSid = evidence.currentSid

  if (!nonEmpty(expectedSid)) {
    return refuse(REASONS.SID_MISMATCH, 'no expected SID supplied', evidence)
  }
  if (runnerSid && currentSid === runnerSid) {
    return refuse(REASONS.SHARED_RUNNER, 'current token is the shared runner identity', evidence)
  }
  if (SYSTEM_SIDS.has(currentSid) || /-500$/.test(currentSid)) {
    return refuse(REASONS.SHARED_RUNNER, 'SYSTEM/administrator identity is not a one-time user', evidence)
  }
  if (currentSid !== expectedSid) {
    return refuse(REASONS.SID_MISMATCH, 'current SID does not match expected SID', evidence)
  }

  const expectedRoaming = path.win32.join(evidence.userProfile, 'AppData', 'Roaming')
  const expectedLocal = path.win32.join(evidence.userProfile, 'AppData', 'Local')
  if (normalize(evidence.knownFolderRoaming) !== normalize(expectedRoaming)) {
    return refuse(REASONS.FOLDER_REDIRECTED, 'Roaming is not under the profile', evidence)
  }
  if (normalize(evidence.knownFolderLocal) !== normalize(expectedLocal)) {
    return refuse(REASONS.FOLDER_REDIRECTED, 'Local is not under the profile', evidence)
  }

  if (Array.isArray(evidence.reparsePoints) && evidence.reparsePoints.length > 0) {
    return refuse(REASONS.REPARSE_POINT, 'reparse point in the test boundary: ' +
      evidence.reparsePoints.join(','), evidence)
  }

  if (normalize(evidence.testRoot) !== normalize(evidence.userProfile)) {
    return refuse(REASONS.UNSAFE_TEST_ROOT,
      'dedicated-user mode requires testRoot == the one-time user profile', evidence)
  }
  for (const [name, target] of [
    ['data', evidence.targetData],
    ['vault', evidence.targetVault],
    ['local', evidence.targetLocal],
    ['install', evidence.targetInstall],
  ]) {
    if (target && !under(target, evidence.testRoot)) {
      return refuse(REASONS.UNSAFE_TEST_ROOT, name + ' path escapes the test root', evidence)
    }
  }

  if (typeof evidence.ownerSid !== 'string' || evidence.ownerSid !== expectedSid) {
    return refuse(REASONS.OWNERSHIP, 'test root owner is not the expected SID', evidence)
  }
  if (Array.isArray(evidence.existingInstall) && evidence.existingInstall.length > 0) {
    return refuse(REASONS.EXISTING_INSTALL, 'existing Termius install entries found', evidence)
  }
  if (evidence.phase !== 'post-install' &&
      Array.isArray(evidence.existingData) && evidence.existingData.length > 0) {
    return refuse(REASONS.EXISTING_DATA, 'existing app data found before the test', evidence)
  }
  if (evidence.cleanupProbe === 'FAIL') {
    return refuse(REASONS.CLEANUP_PERMISSION, 'cleanup create/delete probe failed', evidence)
  }

  const mode = evidence.mode
  if (mode === 'disposable-vm') {
    const attestation = evidence.vmAttestation
    if (!attestation ||
        !nonEmpty(attestation.runId) ||
        attestation.runId !== evidence.runId ||
        !nonEmpty(attestation.instanceId) ||
        !nonEmpty(attestation.imageId)) {
      return refuse(REASONS.VM_ATTESTATION, 'no run-bound disposable VM attestation', evidence)
    }
    return {
      provider: 'windows-isolation-classifier',
      classification: 'ISOLATED_DISPOSABLE_VM',
      isolated: true,
      wouldTouchRealProfile: false,
      reasonCode: 'ISOLATED_DISPOSABLE_VM',
      reasonDetail: 'one-time VM attestation matched the run',
      evidenceComplete: true,
      readOnlyPreflight: true,
      checks: evidence.checks || [],
    }
  }
  if (mode !== 'dedicated-user') {
    return refuse(REASONS.EVIDENCE_INCOMPLETE, 'unknown mode: ' + mode, evidence)
  }
  return {
    provider: 'windows-isolation-classifier',
    classification: 'ISOLATED_DEDICATED_USER',
    isolated: true,
    wouldTouchRealProfile: false,
    reasonCode: 'ISOLATED_DEDICATED_USER',
    reasonDetail: 'SID, profile, Known Folders, ownership and clean state all match',
    evidenceComplete: true,
    readOnlyPreflight: true,
    checks: evidence.checks || [],
  }
}

function parseArgs(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      flags[token.slice(2)] = argv[index + 1]
      index += 1
    }
  }
  return flags
}

function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (!flags.evidence || !flags.out) {
    console.error('usage: windows-isolation-classify.mjs --evidence <json> --out <json>')
    process.exit(2)
  }
  let evidence
  try {
    evidence = JSON.parse(readFileSync(flags.evidence, 'utf8'))
  } catch (error) {
    console.error('cannot read evidence: ' + error.message)
    process.exit(2)
  }
  const report = classifyWindowsIsolation(evidence)
  writeFileSync(flags.out, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  process.exit(report.isolated ? 0 : 1)
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) main()

export { under }
