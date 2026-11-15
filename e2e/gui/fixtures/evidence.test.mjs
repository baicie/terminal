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

import { redact, writeEvidence } from './evidence.mjs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Read the record the writer just produced. */
async function written(caseId, options) {
  const file = await writeEvidence(caseId, options)
  const record = JSON.parse(await readFile(file, 'utf8'))
  await rm(path.dirname(path.dirname(file)), { recursive: true, force: true })
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

test('redact leaves ordinary text alone', () => {
  // A filter that mangles every string is a filter people turn off.
  const text = 'dock width 300px, content 276px, presentation single'
  assert.equal(redact(text), text)
})
