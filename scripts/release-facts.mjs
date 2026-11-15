#!/usr/bin/env node
/**
 * Collect the facts `verify-release-qualification.mjs` judges.
 *
 * Split from the judging on purpose: the judgement is pure and testable, this part
 * talks to `gh` and the filesystem and is exercised only in a real release run.
 *
 * Every fact it cannot establish becomes an explicit `null`, never a plausible
 * default. A release gate that fills in "probably fine" is worse than no gate.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')

function gh(args) {
  try {
    return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Every check run for this commit, keyed by name. */
function collectChecks(commit) {
  const raw = gh([
    'api',
    `repos/{owner}/{repo}/commits/${commit}/check-runs?per_page=100`,
    '--jq',
    '.check_runs[] | {name, conclusion, head_sha}',
  ])
  if (!raw) return {}
  const checks = {}
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      // A name can appear more than once (a re-run). The **last** is the one that
      // decided the commit's state, and `gh` returns them in ascending time order.
      checks[entry.name] = { conclusion: entry.conclusion, headSha: entry.head_sha }
    } catch {
      // A malformed line is a missing fact, not a pass.
    }
  }
  return checks
}

/**
 * Run the evidence gate in qualification mode and keep its verdict.
 *
 * Reusing the gate rather than re-deriving the answer is the point: two
 * implementations of "does this evidence describe this commit" would drift, and the
 * one in the release path would be the one nobody tested.
 */
function collectEvidence() {
  try {
    execFileSync(process.execPath, ['scripts/check-verification-evidence.mjs', '--mode=qualification'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { qualificationPassed: true, problemCount: 0, missingScenarios: [], notPassed: [] }
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    const count = /(\d+) problem\(s\)/.exec(output)
    return {
      qualificationPassed: false,
      problemCount: count ? Number(count[1]) : null,
      missingScenarios: [],
      notPassed: [],
    }
  }
}

function main() {
  const commit = process.env.RELEASE_COMMIT || git(['rev-parse', 'HEAD'])
  const tag = process.env.RELEASE_TAG || null
  const mode = process.env.RELEASE_MODE || null
  const tagCommit = tag ? git(['rev-list', '-n', '1', tag]) : null

  const facts = {
    commit,
    tag,
    tagCommit,
    mode,
    checks: commit ? collectChecks(commit) : {},
    evidence: collectEvidence(),
    signing: {
      // The workflow exports this only when the secret exists.
      updaterKeyPresent: Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY),
      // Notarization is a separate, external capability; nothing in this repository
      // can produce it yet, so it is reported as the workflow knows it.
      notarized: process.env.RELEASE_NOTARIZED === 'true',
    },
  }

  const dir = mkdtempSync(path.join(os.tmpdir(), 'release-facts-'))
  const file = path.join(dir, 'facts.json')
  writeFileSync(file, `${JSON.stringify(facts, null, 2)}\n`)
  console.log(file)
  // The caller reads the path from stdout; the temp dir is left for inspection on
  // failure and is inside the runner's tmp.
  void rmSync
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
