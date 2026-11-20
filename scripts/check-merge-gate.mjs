#!/usr/bin/env node
/**
 * CLI wrapper around `merge-gate.mjs`.
 *
 * All the rules live in the pure `decideMerge`; this file only fetches the facts and
 * prints the verdict. Keeping the split means the tests can exercise every trap with
 * a literal fixture instead of merging a real PR.
 *
 * ## Why it reads the head SHA from the PR, not from the checks
 *
 * `gh pr checks` already reports the checks attached to the PR head, so the two agree
 * in practice. The SHA is still collected and printed: the person reading the report
 * is often looking at a browser tab that may be older than the merge button's state,
 * and the only way to know they match is to compare a SHA they can see.
 *
 * Usage:
 *   node scripts/check-merge-gate.mjs --pr 123 [--json] [--repo owner/name]
 *
 * Exit codes: 0 = may merge, 1 = blocked, 2 = could not determine (auth/network).
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { decideMerge, GATE_SCOPE } from './merge-gate.mjs'

const argv = process.argv.slice(2)
const flag = name => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const asJson = argv.includes('--json')
const prNumber = flag('--pr')
const repo = flag('--repo') ?? 'baicie/terminal'

if (!prNumber) {
  console.error('usage: node scripts/check-merge-gate.mjs --pr <number> [--json]')
  process.exit(2)
}

const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

let pr
let checks
try {
  pr = JSON.parse(
    gh([
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json',
      'number,title,state,isDraft,mergeable,mergeStateStatus,headRefOid,baseRefName,url',
    ]),
  )
} catch (error) {
  console.error(`could not read PR #${prNumber}: ${String(error.stderr ?? error.message).trim()}`)
  process.exit(2)
}

/*
 * `gh pr checks` exits 8 when checks are pending. That is not an error here — the JSON
 * payload is still written and `decideMerge` needs it. `execFileSync` throws on any
 * non-zero status, so the throw is inspected rather than propagated; only a payload
 * that is not JSON becomes exit 2.
 */
try {
  checks = JSON.parse(
    gh(['pr', 'checks', String(prNumber), '--repo', repo, '--json', 'name,state,bucket,link']),
  )
} catch (error) {
  const stdout = String(error.stdout ?? '')
  if (stdout.trim().startsWith('[')) {
    checks = JSON.parse(stdout)
  } else if (/no checks reported/i.test(String(error.stderr ?? ''))) {
    checks = []
  } else {
    console.error(`could not read checks for #${prNumber}: ${String(error.stderr ?? error.message).trim()}`)
    process.exit(2)
  }
}

const decision = decideMerge({ pr, checks })
const report = {
  ...decision,
  pr: pr.number,
  title: pr.title,
  url: pr.url,
  base: pr.baseRefName,
  mergeStateStatus: pr.mergeStateStatus,
  scope: GATE_SCOPE,
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  const lines = [
    `PR #${report.pr} — ${report.title}`,
    `  head     ${report.headSha}`,
    `  base     ${report.base}`,
    `  checks   ${report.counts.pass} pass / ${report.counts.fail} fail / ` +
      `${report.counts.pending} pending / ${report.counts.cancelled} cancelled / ` +
      `${report.counts.skipped} skipped`,
    `  verdict  ${report.verdict}`,
  ]
  if (report.problems.length > 0) {
    lines.push('', '  Blocked by:')
    for (const problem of report.problems) lines.push(`   • ${problem}`)
  }
  lines.push('', `  ${report.scope}`, '')
  process.stdout.write(`${lines.join('\n')}\n`)
}

process.exit(report.verdict === 'MAY_MERGE' ? 0 : 1)
