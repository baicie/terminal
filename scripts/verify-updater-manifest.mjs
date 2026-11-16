#!/usr/bin/env node
/**
 * Validate a published `latest.json` against the release it claims to describe.
 *
 * Called from `release.yml` immediately before the updater channel is switched, and
 * again on the manifest read back from the channel.
 *
 * Reads `VERSION`, `RELEASE_TAG` and `GITHUB_REPOSITORY` from the environment so the
 * comparison is against the release being cut, not against whatever the file says.
 *
 * Usage: VERSION=x.y.z RELEASE_TAG=vx.y.z GITHUB_REPOSITORY=owner/name \
 *          node scripts/verify-updater-manifest.mjs <latest.json>
 *
 * Exit codes: 0 the manifest is usable, 1 it is not, 2 usage/config error.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { judgeManifest, verifyUpdaterSignatures } from './updater-manifest-check.mjs'

export function main({
  manifestPath,
  version = process.env.VERSION,
  tag = process.env.RELEASE_TAG,
  repository = process.env.GITHUB_REPOSITORY,
  readFile = readFileSync,
  log = console.log,
  logError = console.error,
  // ## Optional cryptographic verification
  //
  // `judgeManifest` checks that a signature is *present*; it cannot say whether it is
  // *valid for the payload*. That needs the public key and the payload bytes, which the
  // release workflow has. When `pubkey` and `payloadDir` are supplied, every platform's
  // signature is verified and a failure is fatal. When they are not, the verdict stays
  // what it was — structural only — and the caller is told so rather than being left to
  // assume the stronger claim.
  pubkey = process.env.TAURI_UPDATER_PUBKEY ?? null,
  payloadDir = process.env.UPDATER_PAYLOAD_DIR ?? null,
  verifySignature = defaultVerifySignature,
} = {}) {
  if (!manifestPath) {
    logError('usage: verify-updater-manifest.mjs <latest.json>')
    return 2
  }
  if (!version || !tag || !repository) {
    // Refusing is the safe direction: without the expected version there is nothing to
    // compare against, and "the version field exists" is what the old check already did.
    logError(
      'VERSION, RELEASE_TAG and GITHUB_REPOSITORY must be set; the manifest is judged ' +
        'against the release being cut, not against itself',
    )
    return 2
  }

  let manifest
  try {
    manifest = JSON.parse(readFile(path.resolve(manifestPath), 'utf8'))
  } catch (error) {
    logError(`could not read ${manifestPath}: ${error.message}`)
    return 1
  }

  const { ok, problems } = judgeManifest(manifest, { version, tag, repository })
  if (!ok) {
    logError(`updater manifest is not usable — ${problems.length} problem(s)`)
    for (const problem of problems) logError(`  [${problem.code}] ${problem.message}`)
    return 1
  }

  // ## Signature validity, when it can be established
  if (pubkey && payloadDir) {
    const payloads = {}
    for (const platform of Object.keys(manifest.platforms)) {
      // The release stores `<payload>.sig` next to the payload; the manifest only carries
      // the signature text, so the payload name comes from the URL's last path segment.
      const fromUrl = path.basename(new URL(manifest.platforms[platform].url).pathname)
      const candidate = path.join(payloadDir, fromUrl)
      try {
        readFile(candidate)
        payloads[platform] = candidate
      } catch {
        // Leave it unset so the verifier reports NOT_VERIFIED rather than failing here:
        // "the payload is not on disk" and "the signature is wrong" are different facts.
      }
    }
    const verdict = verifyUpdaterSignatures(manifest, {
      payloads,
      verify: (payloadPath, signature) => verifySignature({ payloadPath, signature, pubkey }),
    })
    if (verdict.invalid.length > 0) {
      logError(`signature verification FAILED for: ${verdict.invalid.join(', ')}`)
      for (const entry of verdict.results.filter(r => r.status === 'INVALID')) {
        logError(`  ${entry.platform}: ${entry.reason}`)
      }
      return 1
    }
    if (verdict.unverified.length > 0) {
      // ## A release must not claim what it could not check
      logError(
        `could not verify the signature for: ${verdict.unverified.join(', ')} — ` +
          'the payload was not present in UPDATER_PAYLOAD_DIR. Refusing to report the ' +
          'manifest as verified.',
      )
      return 1
    }
    log(`updater signatures verified for ${verdict.results.length} platform(s)`)
  } else {
    log(
      'updater manifest OK (structure only): TAURI_UPDATER_PUBKEY / UPDATER_PAYLOAD_DIR ' +
        'were not supplied, so the signatures were checked for presence, not validity',
    )
  }

  log(`updater manifest OK: ${version} with ${Object.keys(manifest.platforms).length} platform(s)`)
  return 0
}

/**
 * Verify one minisign signature against its payload with the Tauri CLI.
 *
 * Kept injectable so the CLI's decision logic is testable without a keypair or a real
 * tarball; the release workflow uses this default.
 */
function defaultVerifySignature({ payloadPath, signature, pubkey }) {
  const { execFileSync } = require('node:child_process')
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
  const os = require('node:os')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'minisign-'))
  try {
    const sigPath = path.join(dir, 'payload.sig')
    writeFileSync(sigPath, signature)
    execFileSync('pnpm', ['tauri', 'signer', 'verify', '--public-key', pubkey, '--signature', sigPath, payloadPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: String(error.stderr ?? error.message).trim().slice(0, 300) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  logError(`updater manifest is not usable — ${problems.length} problem(s)`)
  for (const problem of problems) logError(`  [${problem.code}] ${problem.message}`)
  return 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main({ manifestPath: process.argv[2] }))
}
