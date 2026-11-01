import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildRow,
  buildRows,
  classifyReach,
  inTree,
  MISSING_INPUT_MESSAGE,
  parseArgs,
  readAudit,
  snapshotNotFoundMessage,
  summarize,
} from './build-security-ledger.mjs'
import {
  highSeverityInGraph,
  NOT_PUBLISHED,
  renderLedgerMarkdown,
} from './security-ledger-report.mjs'

const FIXTURES = path.join(import.meta.dirname, 'fixtures/security-ledger')

const read = name => readFileSync(path.join(FIXTURES, name), 'utf8')

const NORMAL_TREE = read('cargo-tree-normal.txt')
const ALL_TREE = read('cargo-tree-all.txt')
const AUDIT = JSON.parse(read('audit-sample.json'))

// The real script's probe runs cargo tree --invert. Tests pass a stub so the
// three-state logic is exercised without a cargo toolchain: `absentCrates`
// lists the crates the probe agrees have no path to the root.
function stubTrees(absentCrates = ['quinn-proto'], overrides = {}) {
  return {
    normalTree: NORMAL_TREE,
    allTree: ALL_TREE,
    verifyAbsent: name => absentCrates.includes(name),
    ...overrides,
  }
}

const rowsById = rows => new Map(rows.map(row => [row.id, row]))

test('a published v3.1 vector yields both a base score and a rating', () => {
  const entry = AUDIT.vulnerabilities.list.find(
    item => item.advisory.id === 'RUSTSEC-2026-0154',
  )
  const row = buildRow(entry, stubTrees())

  // The vector RustSec publishes for the russh advisory. Before the regex fix
  // this cell read "(not published)" for all 27 rows while the vector sat in
  // the snapshot unused.
  assert.equal(row.cvss, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H')
  assert.equal(row.score, 7.5)
  assert.equal(row.severity, 'High')
  assert.equal(row.crate, 'russh')
  assert.equal(row.reach, 'normal dependency')
})

test('every severity rating is derived from its own vector', () => {
  const rows = rowsById(buildRows(AUDIT.vulnerabilities.list, stubTrees()))

  assert.equal(rows.get('RUSTSEC-2026-0153').score, 7.5) // russh-cryptovec
  assert.equal(rows.get('RUSTSEC-2026-0367').score, 7.3) // zip, local AV
  assert.equal(rows.get('RUSTSEC-2026-0367').severity, 'High')
  assert.equal(rows.get('RUSTSEC-2026-0999').score, 3.7) // build-only, Low
  assert.equal(rows.get('RUSTSEC-2026-0999').severity, 'Low')
})

test('an advisory with no vector is marked not-published, never scored', () => {
  const rows = rowsById(buildRows(AUDIT.vulnerabilities.list, stubTrees()))
  const h2 = rows.get('RUSTSEC-2026-0258')

  assert.equal(h2.cvss, NOT_PUBLISHED)
  // Null rather than 0: a missing vector is unknown severity, and a 0.0 would
  // land in the "None" bucket and read as "assessed, harmless".
  assert.equal(h2.score, null)
  assert.equal(h2.severity, null)
})

test('unscored advisories are counted apart from the severity histogram', () => {
  const rows = buildRows(AUDIT.vulnerabilities.list, stubTrees())
  const summary = summarize(rows)

  // h2 and quinn-proto publish no vector; the other four do.
  assert.equal(summary.total, 6)
  assert.equal(summary.unscored, 2)
  assert.equal(summary.inBuildGraph.unscored, 1)
  assert.equal(summary.absent.unscored, 1)

  const histogram = summary.inBuildGraph.bySeverity
  const counted = Object.values(histogram).reduce((a, b) => a + b, 0)
  assert.equal(counted, summary.inBuildGraph.total - summary.inBuildGraph.unscored)
})

test('the summary splits severity by reachability', () => {
  const summary = summarize(buildRows(AUDIT.vulnerabilities.list, stubTrees()))

  // russh 7.5, russh-cryptovec 7.5, zip 7.3 are all in the build graph.
  assert.equal(summary.inBuildGraph.bySeverity.High, 3)
  assert.equal(summary.inBuildGraph.bySeverity.Low, 1)
  // The absent bucket holds quinn-proto only, and it contributes no severity.
  assert.equal(summary.absent.total, 1)
  assert.deepEqual(
    Object.entries(summary.absent.bySeverity).filter(([, n]) => n > 0),
    [],
  )
  assert.equal(summary.absent.crates['quinn-proto'], 1)
})

test('the three reachability states are each derived from cargo tree', () => {
  const trees = stubTrees()

  // In the normal-edges tree.
  assert.equal(classifyReach(trees, 'russh', '0.60.2'), 'normal dependency')
  // Only in the all-edges tree: a build/dev/target-only edge.
  assert.equal(classifyReach(trees, 'buildonly', '1.2.3'), 'build/dev/target-only')
  // In neither, and the inverted probe agrees.
  assert.equal(
    classifyReach(trees, 'quinn-proto', '0.11.14'),
    'absent-from-build-graph',
  )
})

test('a (*) collapsed subtree still counts as present', () => {
  // cargo tree prints ` (*)` on a node whose subtree was already shown
  // elsewhere; the real tree has 1206 such lines. The crate is in the build
  // graph, so treating the marker as absence would manufacture an exemption.
  assert.ok(NORMAL_TREE.includes('h2 v0.4.13 (*)'))
  assert.ok(!NORMAL_TREE.includes('\nh2 v0.4.13\n'))

  assert.equal(inTree(NORMAL_TREE, 'h2', '0.4.13'), true)
  assert.equal(
    classifyReach(stubTrees(['h2', 'quinn-proto']), 'h2', '0.4.13'),
    'normal dependency',
  )

  const rows = rowsById(buildRows(AUDIT.vulnerabilities.list, stubTrees()))
  assert.equal(rows.get('RUSTSEC-2026-0258').reach, 'normal dependency')
})

test('other same-line suffixes do not hide a node either', () => {
  // ` (proc-macro)`, a local path, and both markers at once.
  assert.equal(inTree(NORMAL_TREE, 'proc-macro2', '1.0.106'), true)
  assert.equal(inTree(NORMAL_TREE, 'quote', '1.0.45'), true)
  assert.equal(inTree(NORMAL_TREE, 'terminal', '0.0.1-dev.2'), true)
})

test('a version that is a prefix of another is not confused with it', () => {
  // The old startsWith scan let `rsa v0.9.1` match the line `rsa v0.9.10`,
  // attributing one lockfile entry's advisories to a version that is not there.
  assert.equal(inTree(NORMAL_TREE, 'rsa', '0.9.1'), true)
  assert.equal(inTree(NORMAL_TREE, 'rsa', '0.9.10'), true)
  assert.equal(inTree(NORMAL_TREE, 'rsa', '0.9'), false)
  assert.equal(inTree(NORMAL_TREE, 'zip', '4.6'), false)
  assert.equal(inTree(NORMAL_TREE, 'rs', '0.9.1'), false)
})

test('an absent verdict contradicted by cargo tree --invert is fatal', () => {
  // The line scan says absent, the inverted query finds a path. Emitting the
  // exemption anyway is the one failure that silently excuses a real finding.
  const trees = stubTrees([]) // probe agrees with nothing
  assert.throws(
    () => classifyReach(trees, 'quinn-proto', '0.11.14'),
    /disagrees about quinn-proto v0\.11\.14/,
  )
})

test('a failing cargo tree aborts instead of marking everything absent', () => {
  // The dangerous direction: an empty tree makes every crate look unreachable,
  // i.e. "no advisory affects us". The probe must never be asked to rescue it.
  assert.throws(
    () =>
      buildRows(AUDIT.vulnerabilities.list, {
        normalTree: '',
        allTree: '',
        verifyAbsent: () => true,
      }),
    /cargo tree produced no output/,
  )
})

test('a missing input path is refused with the command that produces one', () => {
  assert.equal(parseArgs([]).input, null)
  assert.equal(parseArgs(['--input', '']).input, null)
  // No silent default: the old script hardcoded /tmp/audit91.json and would
  // happily rebuild the ledger from whatever stale snapshot sat there.
  assert.ok(!MISSING_INPUT_MESSAGE.includes('audit91'))
  assert.match(MISSING_INPUT_MESSAGE, /cargo audit --json/)
  assert.match(MISSING_INPUT_MESSAGE, /--input/)
})

test('an explicit input path is accepted in every documented form', () => {
  assert.equal(parseArgs(['--input', '/snap.json']).input, '/snap.json')
  assert.equal(parseArgs(['--input=/snap.json']).input, '/snap.json')
  assert.equal(parseArgs(['-i', '/snap.json']).input, '/snap.json')
  assert.equal(parseArgs(['/snap.json']).input, '/snap.json')
})

test('an unreadable or empty snapshot is an error, not an empty ledger', () => {
  assert.throws(
    () => readAudit(path.join(FIXTURES, 'does-not-exist.json')),
    /not found/,
  )
  assert.equal(readAudit(path.join(FIXTURES, 'audit-sample.json')).length, 6)
})

test('a missing-file error names the path and still gives the command', () => {
  const message = snapshotNotFoundMessage('/tmp/gone.json')

  assert.match(message, /not found: \/tmp\/gone\.json/)
  assert.match(message, /cargo audit --json/)
  // The two failures must not contradict each other: a path that was given and
  // not found cannot also report that no snapshot was given.
  assert.doesNotMatch(message, /No cargo audit snapshot given/)
})

test('valid JSON that is not an audit snapshot is refused by shape', () => {
  // A ledger built from such a file would have zero rows, which reads as "no
  // known vulnerabilities" - the failure this check exists to prevent.
  assert.throws(
    () => readAudit(path.join(FIXTURES, 'not-an-audit-snapshot.json')),
    /no vulnerabilities\.list array/,
  )
})

test('the rendered table carries a real score on every scored row', () => {
  const rows = buildRows(AUDIT.vulnerabilities.list, stubTrees())
  const markdown = renderLedgerMarkdown(rows, summarize(rows))

  assert.match(markdown, /7\.5 High/)
  assert.match(markdown, /7\.3 High/)
  assert.match(markdown, /3\.7 Low/)

  // The regression this whole file exists for. The advisory table's rows are
  // parsed rather than substring-counted, because the not-published marker also
  // appears legitimately in the summary histograms above the table.
  const dataRows = markdown
    .split('\n')
    .filter(line => /^\| \d+ \| RUSTSEC-/.test(line))
    .map(line => line.split('|').map(cell => cell.trim()))
  assert.equal(dataRows.length, 6)

  // Column 5 is the vector, column 6 the recomputed score. A row holding a real
  // vector but an empty score cell is exactly the bug the broken regex caused:
  // the data was in hand and the column readers rely on was blank anyway.
  const vectorWithoutScore = dataRows.filter(
    cells => cells[5] !== NOT_PUBLISHED && cells[6] === NOT_PUBLISHED,
  )
  assert.deepEqual(vectorWithoutScore, [])

  // Only the two advisories RustSec published no vector for stay unscored.
  const unscored = dataRows.filter(cells => cells[6] === NOT_PUBLISHED)
  assert.deepEqual(
    unscored.map(cells => cells[3]),
    ['h2', 'quinn-proto'],
  )
})

test('the report highlights high severity inside the build graph', () => {
  const rows = buildRows(AUDIT.vulnerabilities.list, stubTrees())
  const high = highSeverityInGraph(rows)

  assert.deepEqual(
    high.map(row => `${row.crate} ${row.score}`),
    ['russh 7.5', 'russh-cryptovec 7.5', 'zip 7.3'],
  )
  // The two SSH-transport crates are the finding worth seeing.
  const markdown = renderLedgerMarkdown(rows, summarize(rows))
  assert.match(markdown, /russh/)
  assert.match(markdown, /russh-cryptovec/)
})
