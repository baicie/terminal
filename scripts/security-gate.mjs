#!/usr/bin/env node
/**
 * The security gate: a scan that found nothing, a scan that found something, and
 * a scan that never ran must be three different outcomes.
 *
 * The Phase 9.1 CI job was `continue-on-error: true` and piped `cargo audit`
 * through `|| true`. Both choices were made for a good reason - 27 advisories
 * could not be cleared in one commit - but the combined effect was that the job
 * reported success while the count went from 21 to 27 to 25 with nobody
 * watching, and a *failed* scan (no advisory database, broken toolchain) read
 * exactly like a clean one. That is the failure mode this file exists to end:
 *
 *   - scan failed            -> exit 2 (infrastructure, never "clean")
 *   - scan found a regression -> exit 1 (a real finding)
 *   - scan found only what is already recorded -> exit 0
 *
 * "Already recorded" is not "ignored". The baseline is a checked-in file listing
 * the advisory ids this build is *known* to carry, each with the reason it could
 * not be fixed. A new advisory, or a new version of a recorded one, fails the
 * gate until somebody writes down why it is acceptable. The file can only shrink
 * without a review, which is what makes it a ratchet instead of a mute button.
 *
 * Reachability is deliberately *not* re-derived here. `build-security-ledger.mjs`
 * owns that, runs the cargo tree probes, and refuses to emit an all-absent
 * ledger; this gate rates the snapshots the CI job already produces.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { cvssBaseScore } from './cvss.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DEFAULT_BASELINE = join(ROOT, 'src-tauri/security-baseline.json')

/**
 * Exit codes are part of the contract, not an implementation detail: a CI step
 * that cannot tell 1 from 2 will report an outage as a security finding, and a
 * reviewer who sees 2 will go looking for an advisory that does not exist.
 */
export const EXIT_PASS = 0
export const EXIT_FINDINGS = 1
export const EXIT_SCAN_FAILED = 2

/**
 * Turns a `cargo audit --json` snapshot into rows, or throws.
 *
 * The distinction this function exists to preserve: an audit that could not
 * reach its advisory database writes an *empty* or *unparseable* file, and both
 * used to be indistinguishable from "no vulnerabilities". A snapshot with no
 * `vulnerabilities.list` is therefore an error, not zero findings.
 */
export function readAuditSnapshot(path) {
  if (!existsSync(path)) {
    throw new Error(
      `cargo audit snapshot not found: ${path}\n`
      + 'The scan did not run. This is not a clean result: run cargo audit and pass --audit.',
    )
  }
  const text = readFileSync(path, 'utf8')
  if (text.trim() === '') {
    throw new Error(
      `cargo audit snapshot is empty: ${path}\n`
      + 'cargo audit writes an empty file when it fails before producing a report.',
    )
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(
      `cargo audit snapshot is not JSON: ${path}\n`
      + 'A toolchain or advisory-db failure can leave partial output behind; refusing to read it as a report.',
    )
  }
  const list = parsed.vulnerabilities?.list
  if (!Array.isArray(list)) {
    throw new Error(
      `${path} has no vulnerabilities.list array; this is not a cargo audit --json snapshot.`,
    )
  }
  return list
}

/**
 * Every advisory class `cargo audit --json` reports, flattened into one list.
 *
 * Vulnerabilities are only part of the answer. A crate that is `unsound` breaks
 * a safety invariant in code this build links, an `unmaintained` crate is a
 * future vulnerability nobody will patch, and a `yanked` release is one the
 * publisher withdrew. `cargo deny` fails on all three by default, and the
 * previous CI job ignored the whole tool, so none of them were gated anywhere.
 *
 * They are kept distinct from vulnerabilities because they are not the same
 * kind of decision: an unmaintained crate can be acceptable for a dependency
 * whose API surface this project does not exercise, while a vulnerability
 * cannot be waved away by a usage argument alone. The `kind` travels with the
 * finding so the baseline reason has to say which argument applies.
 */
export function readAuditWarnings(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const warnings = parsed.warnings
  if (warnings === null || typeof warnings !== 'object') {
    // A snapshot with no `warnings` object predates cargo-audit's warning
    // classes or was produced by a tool that does not emit them. Refusing is
    // safer than reporting "no unsound crates" on no evidence.
    throw new Error(
      `${path} has no warnings object; this is not a cargo audit --json snapshot from a version this gate understands.`,
    )
  }
  const out = []
  for (const kind of ['unmaintained', 'unsound', 'yanked']) {
    // cargo audit omits a class entirely when nothing is in it (yanked is the
    // one that comes and goes in this repo), so a missing key means "none of
    // this class", while a present-but-not-an-array value is still an error.
    if (!(kind in warnings)) continue
    const list = warnings[kind]
    if (!Array.isArray(list)) {
      throw new Error(`${path} has a non-array warnings.${kind}.`)
    }
    for (const entry of list) {
      out.push({ ...entry, kind })
    }
  }
  return out
}

/**
 * The crates whose yanked check `cargo audit` could not perform.
 *
 * `cargo audit` needs the crates.io registry index *in the local cargo home* to
 * answer "has this exact version been yanked?". When the index is missing it
 * prints, per crate,
 *
 *   error: couldn't check if the package is yanked: not found: No such crate in
 *          crates.io index: <name>
 *
 * to stderr, writes nothing to `warnings.yanked`, and exits 1 exactly as it
 * does when it simply found advisories. The JSON therefore *looks* like a
 * complete scan in which no crate is yanked. On the GitHub runner that was 769
 * crates out of 769: the class was not merely empty, it was never evaluated,
 * while this gate reported a clean sweep (P9.3.1 P1-1).
 *
 * A yanked verdict that was never asked for must not be reported as "no yanked
 * crates", so the caller treats a non-empty result as a failed scan.
 */
export function uncheckableYankedCrates(logText) {
  const names = new Set()
  for (const line of logText.split(/\r?\n/)) {
    // Deliberately loose about wording after the crate name: only the "couldn't
    // check ... yanked" prefix carries the meaning, and a future cargo-audit
    // that rephrases the tail must still be caught.
    if (!/couldn't check if the package is yanked/i.test(line)) continue
    const match = /:\s*([A-Za-z0-9_.\-]+)\s*$/.exec(line)
    if (match !== null) names.add(match[1])
  }
  return [...names].sort()
}

/**
 * Classifies the audit's stderr.
 *
 * Returns the yanked-check failures plus every other line cargo audit printed at
 * error level that is NOT one of them, so a scan problem cannot hide behind the
 * one message this gate already knows how to explain.
 */
export function readAuditLog(logText) {
  const uncheckable = uncheckableYankedCrates(logText)
  const otherErrors = logText
    .split(/\r?\n/)
    .filter(line => /\berror:/i.test(line))
    .filter(line => !/couldn't check if the package is yanked/i.test(line))
    .map(line => line.trim())
    .filter(line => line !== '')
  return { uncheckable, otherErrors }
}

/** One audit entry, flattened to what the gate compares and prints. */
export function toFinding(entry) {
  const advisory = entry.advisory ?? {}
  const scored = cvssBaseScore(advisory.cvss ?? '')
  return {
    // A yanked entry carries no advisory object, so it is identified by the
    // withdrawal itself. Spelling that out as a stable id keeps the baseline
    // key meaningful instead of an empty string that would collide across crates.
    id: advisory.id ?? `YANKED-${entry.package?.name ?? 'unknown'}`,
    kind: entry.kind ?? 'vulnerability',
    crate: entry.package?.name ?? '',
    version: entry.package?.version ?? '',
    title: advisory.title ?? (entry.kind === 'yanked' ? 'yanked release' : ''),
    severity: scored ? scored.severity : null,
    score: scored ? scored.score : null,
  }
}

/**
 * The baseline's shape. A file that is absent, empty, or missing ids is a
 * configuration error rather than "no exemptions": silently treating a
 * half-written baseline as empty would fail the build on every advisory, and
 * treating it as "allow everything" would make the gate decorative.
 */
export function readBaseline(path) {
  if (!existsSync(path)) {
    throw new Error(
      `security baseline not found: ${path}\n`
      + 'Create it with the advisories this build knowingly carries, or pass --baseline.',
    )
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const accepted = parsed.accepted
  if (!Array.isArray(accepted)) {
    throw new Error(`${path} has no accepted[] array.`)
  }
  // Keyed by id AND crate, with a list of accepted versions per key. One advisory
  // can fire against two locked versions of the same crate at once (rsa does
  // today: 0.9.10 not in the graph, 0.10.0-rc.18 in it), and those are genuinely
  // different decisions - one is residue, the other is an accepted live risk. A
  // map keyed by id alone would let the second ride in on the first's approval.
  const byKey = new Map()
  for (const entry of accepted) {
    if (typeof entry.id !== 'string' || typeof entry.crate !== 'string') {
      throw new Error(
        `${path} has an accepted entry without a string id and crate: ${JSON.stringify(entry)}`,
      )
    }
    if (typeof entry.version !== 'string') {
      throw new Error(
        `${path} entry ${entry.id} for ${entry.crate} has no string version.`,
      )
    }
    const key = `${entry.kind ?? 'vulnerability'}|${entry.id}|${entry.crate}`
    const entries = byKey.get(key) ?? []
    if (entries.some(existing => existing.version === entry.version)) {
      throw new Error(
        `${path} lists ${entry.id} for ${entry.crate} ${entry.version} twice.`,
      )
    }
    entries.push(entry)
    byKey.set(key, entries)
  }
  return byKey
}

/**
 * Compares the scan against the baseline.
 *
 * A recorded advisory whose *version* changed is reported as changed, not as
 * accepted: `RUSTSEC-2026-0387` on crypto-bigint 0.5.5 and on 0.7.0-rc.28 are
 * different exposure, and a version bump must not inherit an approval silently.
 */
export function compare(findings, baseline) {
  // Tracked per accepted entry rather than per key, so that a key with two
  // accepted versions still reports the one that vanished as resolved.
  const seen = new Set()
  const fresh = []
  const changed = []
  for (const finding of findings) {
    const key = `${finding.kind}|${finding.id}|${finding.crate}`
    const accepted = baseline.get(key)
    if (accepted === undefined) {
      fresh.push(finding)
      continue
    }
    const match = accepted.find(entry => entry.version === finding.version)
    if (match !== undefined) {
      seen.add(`${key}|${finding.version}`)
      continue
    }
    changed.push({
      ...finding,
      acceptedVersions: accepted.map(entry => entry.version),
    })
  }
  const resolved = []
  for (const [key, entries] of baseline.entries()) {
    for (const entry of entries) {
      if (!seen.has(`${key}|${entry.version}`)) resolved.push(entry)
    }
  }
  return { fresh, changed, resolved }
}

/**
 * Renders the verdict for a log a reviewer will actually read.
 *
 * `resolved` advisories are printed but never fail: a baseline that still lists
 * a fixed advisory is stale documentation, and failing on it would punish the
 * person who just fixed something.
 */
export function renderReport({ count, fresh, changed, resolved, baselinePath }) {
  const lines = []
  lines.push(`Security gate: ${count} advisories in this scan.`)
  if (fresh.length === 0 && changed.length === 0) {
    lines.push(`Nothing outside the recorded baseline (${baselinePath}).`)
  }
  if (fresh.length > 0) {
    lines.push('', `NEW advisories (${fresh.length}) - not in the baseline:`)
    for (const finding of fresh) {
      const rating = finding.score === null
        ? 'unscored'
        : `${finding.score.toFixed(1)} ${finding.severity}`
      lines.push(
        `  - [${finding.kind}] ${finding.id} ${finding.crate} ${finding.version} (${rating}): ${finding.title}`,
      )
    }
    lines.push(
      '',
      'Fix it, or record it in security-baseline.json with the reason it cannot be fixed.',
      'Do not widen the baseline to make this pass: an unreviewed entry is the bug.',
    )
  }
  if (changed.length > 0) {
    lines.push('', `RECORDED but on a different version (${changed.length}):`)
    for (const finding of changed) {
      lines.push(
        `  - ${finding.id} ${finding.crate} ${finding.version}`
        + ` (baseline says ${finding.acceptedVersions.join(', ')}): ${finding.title}`,
      )
    }
    lines.push(
      '',
      'A new version is new exposure: update the baseline entry deliberately,',
      'so the diff shows that somebody decided this version is acceptable too.',
    )
  }
  if (resolved.length > 0) {
    lines.push(
      '',
      `RESOLVED (${resolved.length}) - still listed in the baseline but not in this scan:`,
    )
    for (const entry of resolved) {
      lines.push(`  - [${entry.kind ?? 'vulnerability'}] ${entry.id} ${entry.crate} ${entry.version}`)
    }
    lines.push('Remove these from the baseline so the record matches the build.')
  }
  return lines.join('\n')
}

/** Parse `--audit <path>` / `--baseline <path>` without a dependency. */
export function parseArgs(argv) {
  const out = { audit: null, auditLog: null, baseline: DEFAULT_BASELINE }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const takeValue = () => {
      const value = argv[index + 1]
      index += 1
      return value ?? null
    }
    if (arg === '--audit' || arg === '-a') {
      out.audit = takeValue()
    } else if (arg.startsWith('--audit=')) {
      out.audit = arg.slice('--audit='.length)
    } else if (arg === '--audit-log') {
      out.auditLog = takeValue()
    } else if (arg.startsWith('--audit-log=')) {
      out.auditLog = arg.slice('--audit-log='.length)
    } else if (arg === '--baseline' || arg === '-b') {
      out.baseline = takeValue() ?? DEFAULT_BASELINE
    } else if (arg.startsWith('--baseline=')) {
      out.baseline = arg.slice('--baseline='.length)
    }
  }
  return out
}

/**
 * The exit code for a comparison result. Split out from main so the tests can
 * pin the three-way distinction without spawning a process.
 */
export function verdictFor({ fresh, changed }) {
  return fresh.length === 0 && changed.length === 0 ? EXIT_PASS : EXIT_FINDINGS
}

export function main(argv = process.argv.slice(2)) {
  const { audit, auditLog, baseline: baselinePath } = parseArgs(argv)
  if (audit === null) {
    console.error(
      'No cargo audit snapshot given.\n'
      + 'This gate does not fall back to a committed snapshot: an old scan is not a scan.\n\n'
      + '  cd src-tauri && cargo audit --json > "$TMPDIR/audit.json"\n'
      + '  node scripts/security-gate.mjs --audit "$TMPDIR/audit.json"',
    )
    return EXIT_SCAN_FAILED
  }

  // A yanked verdict that was never evaluated is not the same as "nothing is
  // yanked". Without the crates.io index in the local cargo home, cargo audit
  // says so on stderr and still exits 1 with an otherwise valid JSON report.
  if (auditLog !== null) {
    if (!existsSync(auditLog)) {
      console.error(
        `cargo audit log not found: ${auditLog}\n`
        + 'Pass the captured stderr, or omit --audit-log and accept that the '
        + 'yanked class is unverified.',
      )
      return EXIT_SCAN_FAILED
    }
    const { uncheckable, otherErrors } = readAuditLog(readFileSync(auditLog, 'utf8'))
    if (uncheckable.length > 0) {
      console.error(
        `cargo audit could not evaluate the yanked class for ${uncheckable.length} crate(s):\n`
        + `  ${uncheckable.slice(0, 10).join(', ')}${uncheckable.length > 10 ? ', ...' : ''}\n\n`
        + 'This happens when the crates.io registry index is missing from the local\n'
        + 'cargo home. cargo audit still exits 1 and still writes a valid report in\n'
        + 'which warnings.yanked is absent -- so a clean-looking report here means\n'
        + '"never checked", not "no yanked crates".\n\n'
        + 'Fix the scan (let cargo fetch the index, or vendor it into CARGO_HOME)\n'
        + 'instead of recording the crates as acceptable.',
      )
      return EXIT_SCAN_FAILED
    }
    if (otherErrors.length > 0) {
      console.error(
        'cargo audit logged errors this gate does not recognise:\n'
        + otherErrors.map(line => `  ${line}`).join('\n'),
      )
      return EXIT_SCAN_FAILED
    }
  }

  let findings
  let baseline
  try {
    findings = [
      ...readAuditSnapshot(audit).map(toFinding),
      ...readAuditWarnings(audit).map(toFinding),
    ]
    baseline = readBaseline(baselinePath)
  } catch (error) {
    // Every throw above means "the gate could not evaluate", which must never be
    // reported as a pass.
    console.error(error.message)
    return EXIT_SCAN_FAILED
  }

  const result = compare(findings, baseline)
  console.log(
    renderReport({
      count: findings.length,
      ...result,
      baselinePath,
    }),
  )
  return verdictFor(result)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
