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

import { judgeManifest } from './updater-manifest-check.mjs'

export function main({
  manifestPath,
  version = process.env.VERSION,
  tag = process.env.RELEASE_TAG,
  repository = process.env.GITHUB_REPOSITORY,
  readFile = readFileSync,
  log = console.log,
  logError = console.error,
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
  if (ok) {
    log(`updater manifest OK: ${version} with ${Object.keys(manifest.platforms).length} platform(s)`)
    return 0
  }
  logError(`updater manifest is not usable — ${problems.length} problem(s)`)
  for (const problem of problems) logError(`  [${problem.code}] ${problem.message}`)
  return 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main({ manifestPath: process.argv[2] }))
}
