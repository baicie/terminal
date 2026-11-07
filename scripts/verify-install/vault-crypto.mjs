#!/usr/bin/env node
/**
 * Test-only Vault fixture compatible with src-tauri/src/vault.rs.
 *
 * Format: AES-256-GCM, base64(nonce12 || ciphertext || tag16);
 * Argon2id v19, m=19456 KiB, t=2, p=1, 32-byte key, 16-byte unpadded-base64
 * salt; verifier = base64(HMAC-SHA256(key, "terminal-vault-verifier-v1" + salt)).
 *
 * This is deliberately independent of the Rust implementation so a fixture
 * produced here proves the file can be decrypted, not merely that Rust agrees
 * with itself. No production password or user data is used.
 */
import * as crypto from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

export const VAULT_DOMAIN = 'terminal-vault-verifier-v1'
export const KDF = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 }

export function requireArgon2() {
  if (typeof crypto.argon2Sync !== 'function') {
    throw new Error('crypto.argon2Sync is required (Node 24.16+)')
  }
}

export function deriveKey(password, saltString) {
  requireArgon2()
  const salt = Buffer.from(saltString, 'base64')
  if (salt.length !== 16 || salt.toString('base64').replace(/=+$/, '') !== saltString) {
    throw new Error('salt must be 16 bytes encoded as unpadded base64')
  }
  return Buffer.from(crypto.argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    parallelism: KDF.parallelism,
    tagLength: KDF.tagLength,
    memory: KDF.memory,
    passes: KDF.passes,
  }))
}

export function encryptValue(value, key) {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64')
}

export function decryptValue(encoded, key) {
  const raw = Buffer.from(encoded, 'base64')
  if (raw.length < 12 + 16) throw new Error('ciphertext is too short')
  const nonce = raw.subarray(0, 12)
  const tag = raw.subarray(raw.length - 16)
  const ciphertext = raw.subarray(12, raw.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function verifierFor(key, saltString) {
  return crypto.createHmac('sha256', key).update(VAULT_DOMAIN + saltString).digest('base64')
}

export function createVaultFile(path, password, entries) {
  requireArgon2()
  const salt = crypto.randomBytes(16).toString('base64').replace(/=+$/, '')
  const key = deriveKey(password, salt)
  const encrypted = {}
  for (const [name, value] of Object.entries(entries)) {
    encrypted[name] = encryptValue(value, key)
  }
  const file = { salt, entries: encrypted, verifier: verifierFor(key, salt) }
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n')
  return file
}

export function verifyVaultFile(path, password, expectedEntries) {
  const file = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof file.salt !== 'string' || typeof file.entries !== 'object') {
    throw new Error('vault file has no salt/entries')
  }
  const key = deriveKey(password, file.salt)
  if (file.verifier) {
    const expected = verifierFor(key, file.salt)
    if (file.verifier !== expected) throw new Error('verifier does not match the password')
  }
  const decrypted = {}
  for (const [name, value] of Object.entries(file.entries)) {
    decrypted[name] = decryptValue(value, key)
  }
  if (expectedEntries) {
    for (const [name, value] of Object.entries(expectedEntries)) {
      if (decrypted[name] !== value) throw new Error('entry mismatch: ' + name)
    }
  }
  return { salt: file.salt, entries: Object.keys(decrypted), verified: true }
}

export function verifyWrongPasswordRejected(path, password) {
  try {
    verifyVaultFile(path, password)
    return false
  } catch {
    return true
  }
}
