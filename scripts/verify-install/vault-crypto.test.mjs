import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createVaultFile,
  requireArgon2,
  verifyVaultFile,
  verifyWrongPasswordRejected,
} from './vault-crypto.mjs'

const supported = (() => {
  try {
    requireArgon2()
    return true
  } catch {
    return false
  }
})()

test('real Argon2id/AES-GCM fixture unlocks with the password and rejects a wrong one', { skip: !supported }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vault-fixture-'))
  const vault = path.join(dir, 'vault.json')
  createVaultFile(vault, 'test-only-master-password', { host: 'test-only-secret' })
  const parsed = JSON.parse(readFileSync(vault, 'utf8'))
  assert.equal(parsed.salt.endsWith('='), false)
  assert.match(parsed.verifier, /^[A-Za-z0-9+/]+=*$/)
  const result = verifyVaultFile(vault, 'test-only-master-password', { host: 'test-only-secret' })
  assert.equal(result.verified, true)
  assert.equal(verifyWrongPasswordRejected(vault, 'wrong-password'), true)
})

test('tampered ciphertext is rejected', { skip: !supported }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'vault-fixture-'))
  const vault = path.join(dir, 'vault.json')
  createVaultFile(vault, 'test-only-master-password', { host: 'test-only-secret' })
  const parsed = JSON.parse(readFileSync(vault, 'utf8'))
  const raw = Buffer.from(parsed.entries.host, 'base64')
  raw[raw.length - 1] ^= 1
  parsed.entries.host = raw.toString('base64')
  writeFileSync(vault, JSON.stringify(parsed))
  assert.equal(verifyWrongPasswordRejected(vault, 'test-only-master-password'), true)
})
