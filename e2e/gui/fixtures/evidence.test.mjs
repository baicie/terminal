// The evidence writer's contract: it never softens an outcome.
//
// ## The defect this pins
//
// `e2e-03` called `writeEvidence(CASE, { verdict: 'PASS', … })` from its `after()`
// hook unconditionally. `after()` runs whether the cases passed or threw, so a run
// in which three cases failed still produced a PASS record. The `extra` payload
// carrying the measurements was dropped too: `writeEvidence` did not destructure it,
// so the numbers never reached the JSON.
//
// Both are the same class of failure as a gate that reports success on a stale
// checkout: the artefact looks authoritative and says nothing true.
import assert from 'node:assert/strict'
import test from 'node:test'

import { dirtySourceLines, redact, sourceInfo, writeEvidence } from './evidence.mjs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Read the record the writer just produced, then clean up after it.
 *
 * ## The cleanup once deleted the repository's committed evidence
 *
 * It was `rm(path.dirname(path.dirname(file)))`. For `writeEvidence('e2e-test-error')`
 * the file is `e2e/gui/artifacts/e2e-test-error/<case>.json`, so two `dirname`s reach
 * `e2e/gui/artifacts` — and `recursive: true` removed **every committed evidence file**
 * in the repository. Measured: running this test alone deleted `e2e-01/`, `e2e-02/`,
 * `e2e-03/` and `run-summary.json`.
 *
 * The fix removes only the case directory the call created, and only when the id is
 * one this test generated (never a real case).
 */
async function written(caseId, options) {
  if (!caseId.startsWith('e2e-test-')) {
    throw new Error(`this helper only creates throwaway cases; got ${caseId}`)
  }
  const file = await writeEvidence(caseId, options)
  const record = JSON.parse(await readFile(file, 'utf8'))
  // `file` is <artifacts>/<caseId>/<caseId>.json — one dirname is the case directory.
  await rm(path.dirname(file), { recursive: true, force: true })
  return record
}

test('an error makes the verdict FAIL even when the caller said PASS', async () => {
  // The whole point: a spec cannot claim success for a case that failed.
  await assert.rejects(
    () => writeEvidence('e2e-test-contradiction', { verdict: 'PASS', error: 'boom' }),
    /contradicts the recorded error/,
  )
})

test('an error with no verdict supplied is recorded as FAIL', async () => {
  const record = await written('e2e-test-error', { error: 'the dock never opened' })
  assert.equal(record.verdict, 'FAIL')
  assert.match(record.error, /the dock never opened/)
})

test('omitting both verdict and error is NOT_RUN, never PASS', async () => {
  // A case that recorded nothing did not pass; it did not run.
  const record = await written('e2e-test-silent', { notes: 'no assertion was made' })
  assert.equal(record.verdict, 'NOT_RUN')
})

test('an explicit verdict is written verbatim', async () => {
  for (const verdict of ['PASS', 'FAIL', 'PARTIAL', 'NOT_RUN']) {
    const record = await written(`e2e-test-${verdict.toLowerCase()}`, { verdict })
    assert.equal(record.verdict, verdict)
  }
})

test('measurements reach the JSON', async () => {
  // The second half of the defect: `extra` was discarded, so every recorded
  // measurement in e2e-03 was lost while the file still looked complete.
  const record = await written('e2e-test-extra', {
    verdict: 'PASS',
    extra: { measurements: { dock: { width: 300, content: 276 } }, notRunCount: 2 },
  })
  assert.deepEqual(record.extra.measurements.dock, { width: 300, content: 276 })
  assert.equal(record.extra.notRunCount, 2)
})

test('a secret inside a measurement is redacted like any other text', async () => {
  // `extra` is spread into the record, so it has to pass the same filter `notes`
  // does. Otherwise the measurement channel becomes a way to write a credential.
  const record = await written('e2e-test-redaction', {
    verdict: 'PASS',
    extra: {
      command: 'ssh -i /home/u/.ssh/id_ed25519',
      token: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAA',
      nested: { password: 'hunter2' },
    },
  })
  const serialised = JSON.stringify(record)
  assert.equal(serialised.includes('ghp_AAAAAAAAAAAAAAAAAAAAAAAA'), false)
  assert.equal(serialised.includes('hunter2'), false)
})

test('a PARTIAL must declare what it could not do, or it is not readable', async () => {
  // The layer report distinguishes a documented gap from a surface that failed by
  // comparing `notRunCount` against the gaps the spec declared. A PARTIAL with no
  // `gaps` therefore reads as "everything was unexplained", which failed the layer —
  // correct for a run that skipped real assertions, but it must be a deliberate choice
  // rather than an oversight. This pins the convention: a PARTIAL carries `gaps`.
  const record = await written('e2e-test-partial-gaps', {
    verdict: 'PARTIAL',
    notes: 'NOT_RUN one\nNOT_RUN two',
    extra: {
      notRunCount: 2,
      gaps: [
        { id: 'a', reason: 'r', needs: 'n' },
        { id: 'b', reason: 'r', needs: 'n' },
      ],
    },
  })
  assert.equal(record.verdict, 'PARTIAL')
  assert.equal(record.extra.gaps.length, record.extra.notRunCount)
})

test('redact leaves ordinary text alone', () => {
  // A filter that mangles every string is a filter people turn off.
  const text = 'dock width 300px, content 276px, presentation single'
  assert.equal(redact(text), text)
})

test('the test helper refuses a real case id', async () => {
  // Guards the cleanup path: `written('e2e-02')` would build a real case directory and
  // then delete it — and an earlier version's two-`dirname` cleanup deleted the whole
  // artifacts directory. Only throwaway ids may flow through the helper.
  await assert.rejects(() => written('e2e-02', { verdict: 'PASS' }), /only creates throwaway cases/)
})

test('the artifacts directory survives a full run of this test file', async () => {
  // Direct assertion on the hazard that actually happened: a single test file run wiped
  // every committed evidence file. Reading the directory afterwards is cheap and makes
  // the regression impossible to reintroduce silently.
  const { readdir } = await import('node:fs/promises')
  const artifacts = path.join(import.meta.dirname, '..', 'artifacts')
  const entries = await readdir(artifacts)
  assert.ok(entries.length > 0, `the artifacts directory is empty: ${artifacts}`)
  // The committed cases must still be there.
  for (const expected of ['e2e-01', 'e2e-02', 'e2e-03']) {
    assert.ok(entries.includes(expected), `${expected} is missing from the artifacts directory`)
  }
})

/*
 * ## `dirty` must mean something
 *
 * It read `git status --porcelain` over the whole tree. The files under
 * `e2e/gui/artifacts/e2e-0X/` are tracked (they are the committed evidence) and every
 * spec run overwrites its own, so the moment a spec wrote its JSON the tree was dirty.
 *
 * Measured on the merged evidence for `main@486ca6e`: **all ten case files reported
 * `dirty: true`**, on macOS, Linux and Windows, from clean CI checkouts. A flag that is
 * always true tells a reader nothing, and the thing it is supposed to tell them —
 * "can this binary be rebuilt from the recorded SHA" — was never answered.
 *
 * The fix excludes the evidence directory. These tests pin both directions: evidence
 * alone does not make the tree dirty, and real source changes still do.
 */
test('sourceInfo reports a sha and a boolean dirty flag', () => {
  const info = sourceInfo()
  assert.match(info.sha, /^[0-9a-f]{7,40}$|^unknown$/, `sha was ${info.sha}`)
  assert.equal(typeof info.dirty, 'boolean')
})

test('a change inside the evidence directory does not count as dirty', () => {
  /*
   * Behavioural, not a source grep: the predicate is given literal porcelain lines and
   * its answer is what is asserted. The previous shape checked for a regex in this
   * file, which would pass for any implementation that happened to spell the prefix the
   * same way while filtering the wrong column.
   */
  const onlyEvidence = [
    ' M e2e/gui/artifacts/e2e-03/e2e-03.json',
    '?? e2e/gui/artifacts/e2e-04/',
    'M  e2e/gui/artifacts/json/wdio-0-0-1795000000000.json',
  ].join('\n')
  assert.deepEqual(
    dirtySourceLines(onlyEvidence),
    [],
    'a run that only rewrote its own evidence did not change the source',
  )
})

test('a real source change still counts as dirty', () => {
  const mixed = [
    ' M e2e/gui/artifacts/e2e-03/e2e-03.json',
    ' M packages/frontend/src/view/sftp/components/file-pane.tsx',
    '?? scripts/new-thing.mjs',
  ].join('\n')
  const kept = dirtySourceLines(mixed)
  assert.equal(kept.length, 2, `expected the two source lines, got ${JSON.stringify(kept)}`)
  assert.ok(kept.some(line => line.includes('file-pane.tsx')))
  assert.ok(kept.some(line => line.includes('new-thing.mjs')))
})

test('an unavailable git counts as dirty, not clean', () => {
  // Evidence that cannot name its source cannot claim to be reproducible.
  assert.deepEqual(dirtySourceLines('unknown'), ['?? git-unavailable'])
})
