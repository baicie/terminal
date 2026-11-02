#!/usr/bin/env node
/**
 * Build the RustSec ledger for docs/phase9-1/security-advisories.md.
 *
 * Every field here has to be checkable by someone else: the advisory id, the
 * locked version, the CVSS vector RustSec publishes, the base score recomputed
 * from that vector by scripts/cvss.mjs, and - the part that is usually
 * hand-waved - whether the crate is actually in the build graph. Reachability is
 * derived from cargo tree, not from reading the product and guessing which
 * protocols it uses.
 *
 * Two failure directions are treated as fatal rather than papered over, because
 * both produce a ledger that looks complete and reads wrong:
 *   - a missing audit snapshot (would yield an empty ledger), and
 *   - a failing cargo tree (would mark every crate absent-from-build-graph,
 *     i.e. "nothing is reachable", the most dangerous possible conclusion).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cvssBaseScore, SEVERITY_ORDER } from './cvss.mjs'
import { AUDIT_COMMAND, collectCargoTrees } from './security-ledger-cargo.mjs'
import { renderLedgerMarkdown, NOT_PUBLISHED } from './security-ledger-report.mjs'

// Resolve from this file, not from the caller's working directory: the outputs
// belong to the repo root, and a script that silently writes to src-tauri/docs
// is worse than one that fails.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = join(ROOT, 'docs/phase9-1')

// How to produce the snapshot. Shared by "none given" and "given but missing",
// so neither failure leaves the reader to guess the command.
const HOW_TO_PRODUCE = [
  'This script does not guess an input path and does not fall back to a stale',
  'snapshot: an empty or outdated ledger is worse than no ledger.',
  '',
  'Produce a fresh snapshot, then pass it explicitly:',
  '',
  '  ' + AUDIT_COMMAND,
  '  node scripts/build-security-ledger.mjs --input "$TMPDIR/audit.json"',
  '',
  'Note: cargo audit needs a writable ~/.cargo/advisory-db. Inside a sandbox',
  'that holds ~/.cargo read-only it fails with "attempted to take an exclusive',
  'lock on a read-only path"; run it outside the sandbox in that case.',
].join('\n')

export const MISSING_INPUT_MESSAGE =
  'No cargo audit snapshot given.\n\n' + HOW_TO_PRODUCE

/** The same guidance, under a headline naming the path that was not there. */
export function snapshotNotFoundMessage(input) {
  return `cargo audit snapshot not found: ${input}\n\n${HOW_TO_PRODUCE}`
}

/** Parse argv. Returns the explicit --input path, or null when absent. */
export function parseArgs(argv) {
  const out = { input: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input' || arg === '-i') {
      out.input = argv[index + 1] ?? null
      index += 1
    } else if (arg.startsWith('--input=')) {
      out.input = arg.slice('--input='.length)
    } else if (!arg.startsWith('-') && out.input === null) {
      out.input = arg
    }
  }
  if (out.input === '') out.input = null
  return out
}

/**
 * Does `tree` contain exactly this crate at this version?
 *
 * cargo tree writes one node per line as `<name> v<version>`, with optional
 * suffixes on the same line: ` (*)` for a subtree collapsed because it was
 * already printed, ` (proc-macro)`, or a path for a local crate. Those suffixes
 * are why the line is matched by an anchored boundary rather than by equality -
 * a collapsed node is still a present node, and dropping it would invent an
 * absent-from-build-graph verdict for any crate that happens to appear twice.
 *
 * A bare `startsWith(name + ' v' + version)` is not enough either: it would let
 * `rsa v0.9.1` match the line `rsa v0.9.10`, silently attributing one crate's
 * advisories to a different locked version.
 */
export function inTree(tree, name, version) {
  const needle = `${name} v${version}`
  return tree.split('\n').some(line => {
    if (!line.startsWith(needle)) return false
    const rest = line.slice(needle.length)
    // Nothing, or a space-separated suffix. Anything else means the version
    // continued (v0.9.10 vs v0.9.1) and this is a different node.
    return rest === '' || rest.startsWith(' ')
  })
}

/**
 * Three states, each directly checkable by re-running the same command.
 *
 * "absent-from-build-graph" is the only one that can justify an exemption, so it
 * is the one state that is not trusted to a single line scan: the caller passes
 * a `verifyAbsent` probe (cargo tree --invert) and the verdict stands only if
 * the probe agrees the crate has no path to the root.
 */
export function classifyReach(
  { normalTree, allTree, verifyAbsent },
  name,
  version,
) {
  if (inTree(normalTree, name, version)) return 'normal dependency'
  if (inTree(allTree, name, version)) return 'build/dev/target-only'
  if (verifyAbsent && !verifyAbsent(name, version)) {
    // The scan said absent, the inverted query found a path. Refusing to pick
    // one is deliberate: the disagreement means the scan cannot be trusted for
    // the one verdict that grants an exemption.
    throw new Error(
      `cargo tree disagrees about ${name} v${version}: not found by line scan, ` +
        'but cargo tree --invert reports a dependency path. Refusing to emit an ' +
        'absent-from-build-graph exemption on contradictory evidence.',
    )
  }
  return 'absent-from-build-graph'
}

/** Turn one `cargo audit --json` entry into a ledger row. */
export function buildRow(entry, trees) {
  const name = entry.package.name
  const version = entry.package.version
  const advisory = entry.advisory ?? {}
  const vector = advisory.cvss ?? ''
  const scored = cvssBaseScore(vector)
  const kind = entry.kind ?? 'vulnerability'
  const reach = classifyReach(trees, name, version)
  // Only a reachable crate has platforms worth naming: an absent one is absent
  // everywhere, and asking per target would triple the cargo invocations to
  // learn nothing.
  const platforms
    = reach === 'absent-from-build-graph' || !trees.findPlatforms
      ? []
      : trees.findPlatforms(name, version)
  return {
    // A yanked entry carries no advisory object; without a synthesized id it
    // would key as an empty string and collide with the next withdrawal.
    id: advisory.id ?? `YANKED-${name}`,
    kind,
    title: (advisory.title ?? (kind === 'yanked' ? 'withdrawn release' : ''))
      .replace(/\|/g, '\\|'),
    crate: name,
    version,
    cvss: vector || NOT_PUBLISHED,
    // Base score and rating are recomputed from the vector, never read from the
    // snapshot: cargo audit --json publishes no score and no severity field.
    score: scored ? scored.score : null,
    severity: scored ? scored.severity : null,
    reach,
    platforms,
  }
}

/**
 * Read and validate a cargo audit snapshot.
 *
 * Throws rather than returning an empty list: the old script would read a
 * hardcoded path and, if that file had gone, publish a ledger of zero
 * advisories - which reads as "no known vulnerabilities".
 */
export function readAudit(input) {
  if (!existsSync(input)) {
    throw new Error(
      snapshotNotFoundMessage(input),
    )
  }
  const audit = JSON.parse(readFileSync(input, 'utf8'))
  const list = audit.vulnerabilities?.list
  if (!Array.isArray(list)) {
    throw new Error(
      `${input} has no vulnerabilities.list array; this is not a cargo audit --json snapshot.`,
    )
  }
  // The ledger covered only `vulnerabilities.list` until Phase 9.2, which left
  // out everything cargo audit reports under `warnings`: unsound crates, crates
  // nobody maintains, and withdrawn releases. Those are findings a release
  // decision has to see, so they are rows too, tagged with their class so the
  // two kinds of decision stay distinguishable in the table.
  const out = list.map(entry => ({ ...entry, kind: 'vulnerability' }))
  const warnings = audit.warnings
  if (warnings !== null && typeof warnings === 'object') {
    for (const kind of ['unmaintained', 'unsound', 'yanked']) {
      if (!Array.isArray(warnings[kind])) continue
      for (const entry of warnings[kind]) out.push({ ...entry, kind })
    }
  }
  return out
}

/** Build every row, sorted the way the previous ledger sorted them. */
export function buildRows(advisories, trees) {
  // An empty tree would make every crate look absent from the build graph, so
  // the emptiness is caught here rather than silently becoming 27 exemptions.
  for (const [label, tree] of [
    ['--edges normal', trees.normalTree],
    ['--edges all', trees.allTree],
  ]) {
    if (typeof tree !== 'string' || tree.trim() === '') {
      throw new Error(
        `cargo tree produced no output for ${label}. Refusing to build a ledger: ` +
          'an empty tree marks every crate absent-from-build-graph, i.e. "no ' +
          'advisory is reachable", which is the most dangerous wrong answer here.',
      )
    }
  }
  const rows = advisories.map(entry => buildRow(entry, trees))
  rows.sort(
    (a, b) => a.crate.localeCompare(b.crate) || a.version.localeCompare(b.version),
  )
  return rows
}

/**
 * Severity distribution split by reachability.
 *
 * The split is the point of the summary: a 7.5 on a crate that is not in the
 * build graph and a 7.5 on the SSH transport are not the same finding, and a
 * single flat histogram hides exactly that difference.
 */
export function summarize(rows) {
  const blank = () => {
    const counts = Object.fromEntries(SEVERITY_ORDER.map(name => [name, 0]))
    return { total: 0, unscored: 0, bySeverity: counts, crates: {} }
  }
  const summary = { total: rows.length, inBuildGraph: blank(), absent: blank() }
  for (const row of rows) {
    const bucket =
      row.reach === 'absent-from-build-graph' ? summary.absent : summary.inBuildGraph
    bucket.total += 1
    if (row.severity) bucket.bySeverity[row.severity] += 1
    else bucket.unscored += 1
    bucket.crates[row.crate] = (bucket.crates[row.crate] ?? 0) + 1
  }
  summary.unscored = summary.inBuildGraph.unscored + summary.absent.unscored
  summary.byReach = rows.reduce((acc, row) => {
    acc[row.reach] = (acc[row.reach] ?? 0) + 1
    return acc
  }, {})
  return summary
}

export function main(argv = process.argv.slice(2)) {
  const { input } = parseArgs(argv)
  if (!input) {
    console.error(MISSING_INPUT_MESSAGE)
    process.exit(2)
  }

  // readAudit owns both the existence check and the shape check, so a missing
  // file and a file that is not an audit snapshot fail the same way.
  const advisories = readAudit(input)

  // One cargo tree dump serves every lookup. collectCargoTrees does not catch,
  // so a cargo failure throws here instead of degrading into an all-absent
  // ledger.
  const trees = collectCargoTrees()

  const rows = buildRows(advisories, trees)
  const summary = summarize(rows)

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(
    join(OUT_DIR, 'security-advisories.json'),
    JSON.stringify(
      {
        generatedFrom: 'cargo audit --json',
        inputSnapshot: input,
        scoring: 'CVSS v3.1 base score, recomputed from the published vector by scripts/cvss.mjs',
        count: rows.length,
        summary,
        rows,
      },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(
    join(OUT_DIR, 'security-advisories.md'),
    renderLedgerMarkdown(rows, summary),
  )

  console.log(JSON.stringify({ count: rows.length, byReach: summary.byReach, unscored: summary.unscored }, null, 2))
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main()
  } catch (error) {
    // Every throw above is a deliberate refusal to publish a misleading ledger.
    // Print the reason, not a stack trace, and leave the old outputs in place.
    console.error(error.message)
    process.exit(1)
  }
}
