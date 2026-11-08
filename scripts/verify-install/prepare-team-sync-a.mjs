#!/usr/bin/env node
// Materialises the historical client used by the cross-version Team Sync run.
//
// The 'A' side has to be the code that actually shipped, not today's working
// tree with an older version string. The tag and commit are pinned here; if the
// tag moves or the tree differs, the run fails instead of silently testing a
// different client.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const HISTORICAL_TAG = 'v0.0.1-dev.2'
export const HISTORICAL_COMMIT = '835fae82571f3a032a3088c414cff9504c2dcedf'
export const HISTORICAL_TREE_PATH = 'packages/frontend/src'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DEST = path.join(ROOT, 'packages/team-server/.tmp/team-sync-a')

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  })
}

export function prepareHistoricalClient() {
  const resolved = git(['rev-parse', `${HISTORICAL_TAG}^{commit}`]).trim()
  if (resolved !== HISTORICAL_COMMIT) {
    throw new Error(
      `${HISTORICAL_TAG} resolves to ${resolved}, but this harness pins ${HISTORICAL_COMMIT}`,
    )
  }
  const tree = git(['rev-parse', `${HISTORICAL_COMMIT}:${HISTORICAL_TREE_PATH}`]).trim()

  rmSync(DEST, { recursive: true, force: true })
  const staging = mkdtempSync(path.join(os.tmpdir(), 'team-sync-a-'))
  try {
    const archive = git(['archive', HISTORICAL_COMMIT, HISTORICAL_TREE_PATH], {
      encoding: 'buffer',
      maxBuffer: 512 * 1024 * 1024,
    })
    const tarball = path.join(staging, 'client.tar')
    writeFileSync(tarball, archive)
    execFileSync('tar', ['-xf', tarball, '-C', staging], { stdio: ['ignore', 'pipe', 'pipe'] })
    const extracted = path.join(staging, HISTORICAL_TREE_PATH)
    if (!existsSync(path.join(extracted, 'store/team-actions-sync.ts'))) {
      throw new Error('the historical archive does not contain the sync client')
    }
    mkdirSync(path.dirname(DEST), { recursive: true })
    renameSync(extracted, DEST)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }

  // A marker the spec can assert: the tests must be able to say which client
  // they ran, not merely that some client ran.
  writeFileSync(
    path.join(DEST, '.source.json'),
    `${JSON.stringify({ tag: HISTORICAL_TAG, commit: HISTORICAL_COMMIT, tree }, null, 2)}\n`,
  )
  const marker = JSON.parse(readFileSync(path.join(DEST, '.source.json'), 'utf8'))
  return { ...marker, path: DEST }
}

if (import.meta.filename === process.argv[1]) {
  try {
    const result = prepareHistoricalClient()
    process.stdout.write(`historical client: ${result.tag} ${result.commit} tree=${result.tree}\n`)
  } catch (error) {
    console.error(`[team-cross-version] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
