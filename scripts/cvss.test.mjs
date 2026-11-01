import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BASE_METRICS,
  cvssBaseScore,
  parseCvssVector,
  roundUp1,
  severityRating,
  SEVERITY_ORDER,
} from './cvss.mjs'

// Vectors with scores fixed by the CVSS v3.1 specification and by the published
// advisories themselves. These are the regression anchors: if a weight table or
// an equation is edited, every number below has to still come out the same.
const KNOWN_SCORES = [
  // The vector the ledger must score. It is the one RustSec publishes for
  // quick-xml, russh and russh-cryptovec - network, no privileges, no user
  // interaction, availability-only impact - and the whole reason this module
  // exists: before it, the ledger's severity column was empty for all 27 rows.
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H', 7.5, 'High'],
  // Specification section 7.1, maximum scope-unchanged score.
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8, 'Critical'],
  // Scope change raises the same metrics to the 10.0 ceiling.
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10, 'Critical'],
  // RUSTSEC-2023-0071 (rsa, Marvin attack): high attack complexity pulls a
  // confidentiality-total flaw down into Medium.
  ['CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N', 5.9, 'Medium'],
  // RUSTSEC-2026-0367 (zip): local, needs privileges and user interaction.
  ['CVSS:3.1/AV:L/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:H', 7.3, 'High'],
  // RUSTSEC-2026-0369 (zip): integrity and availability, no confidentiality.
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H', 9.1, 'Critical'],
  // RUSTSEC-2026-0285 (rustls): partial confidentiality only.
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N', 5.3, 'Medium'],
  // RUSTSEC-2026-0348 and -0349 (rustls): both land on Low by different paths.
  ['CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L', 3.7, 'Low'],
  ['CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N', 3.7, 'Low'],
  // RUSTSEC-2026-0346 (rustls): every exploitability metric at its hardest.
  ['CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:H/I:N/A:N', 4, 'Medium'],
  // Physical access, all impacts partial.
  ['CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:L', 3.5, 'Low'],
  // Adjacent network with a scope change.
  ['CVSS:3.1/AV:A/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N', 5.4, 'Medium'],
]

test('scores the vectors the specification and the advisories fix', () => {
  for (const [vector, score, severity] of KNOWN_SCORES) {
    const result = cvssBaseScore(vector)
    assert.ok(result, `expected ${vector} to be scorable`)
    assert.equal(result.score, score, `base score for ${vector}`)
    assert.equal(result.severity, severity, `severity for ${vector}`)
  }
})

test('zero impact scores 0.0 / None however reachable the flaw is', () => {
  // Specification section 7.1: impact of zero short-circuits the base score,
  // so the most reachable possible vector still scores nothing.
  const result = cvssBaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')
  assert.deepEqual(
    { score: result.score, severity: result.severity },
    { score: 0, severity: 'None' },
  )
})

test('v3.0 vectors score on the same tables', () => {
  // v3.0 and v3.1 differ only in the Roundup function, which cannot change
  // this vector's result; accepting it keeps older advisories scorable.
  const result = cvssBaseScore('CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
  assert.equal(result.score, 9.8)
  assert.equal(result.version, '3.0')
})

test('temporal and environmental metrics are ignored, not rejected', () => {
  const base = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
  const withTemporal = cvssBaseScore(`${base}/E:F/RL:O/RC:C`)
  assert.equal(withTemporal.score, 9.8, 'base score ignores temporal metrics')
  assert.equal(withTemporal.metrics, 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:F/RL:O/RC:C')
})

test('extracts the double-letter metric body a real v3.1 vector carries', () => {
  // The bug this module replaces: a regex demanding single-letter metric names
  // (/[A-Z]:[A-Z]/...) never matched AV, AC, PR or UI, so every row in the
  // ledger reported "(not published)" while the vector sat in the JSON.
  const parsed = parseCvssVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H')
  assert.equal(parsed.body, 'AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H')
  assert.equal(parsed.version, '3.1')
  for (const metric of BASE_METRICS) {
    assert.ok(metric in parsed.metrics, `${metric} parsed out of the vector`)
  }
})

test('refuses anything it cannot score instead of guessing', () => {
  const unscorable = [
    // Not a string / absent.
    null,
    undefined,
    42,
    '',
    '   ',
    // No version prefix: the shape the old regex expected.
    'AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    // v2 and v4 use different metrics and different equations entirely.
    'CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P',
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    // Illegal value, missing base metric, duplicated metric, malformed part.
    'CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N',
    'CVSS:3.1/AV:N/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H/bogus',
    'CVSS:3.1',
  ]
  for (const vector of unscorable) {
    assert.equal(parseCvssVector(vector), null, `parse ${JSON.stringify(vector)}`)
    assert.equal(cvssBaseScore(vector), null, `score ${JSON.stringify(vector)}`)
  }
})

test('roundUp1 matches the specification Roundup, not Math.ceil', () => {
  // The spec defines Roundup over scaled integers precisely so that a float a
  // hair under a tenth does not get pushed up to it.
  assert.equal(roundUp1(7.44999999999999), 7.5)
  assert.equal(roundUp1(4), 4)
  assert.equal(roundUp1(4.02), 4.1)
  assert.equal(roundUp1(0), 0)
  assert.equal(roundUp1(9.95), 10)
  // Float noise from the impact equations must not change a whole result.
  assert.equal(roundUp1(6.699999999999999), 6.7)
  assert.equal(roundUp1(1.0000000001), 1)
})

test('severity boundaries follow the qualitative scale', () => {
  const boundaries = [
    [0, 'None'],
    [0.1, 'Low'],
    [3.9, 'Low'],
    [4, 'Medium'],
    [6.9, 'Medium'],
    [7, 'High'],
    [8.9, 'High'],
    [9, 'Critical'],
    [10, 'Critical'],
  ]
  for (const [score, rating] of boundaries) {
    assert.equal(severityRating(score), rating, `severity at ${score}`)
  }
  assert.equal(severityRating(Number.NaN), null)
  assert.equal(severityRating('7.5'), null)
})

test('SEVERITY_ORDER lists every rating worst first', () => {
  assert.deepEqual(SEVERITY_ORDER, ['Critical', 'High', 'Medium', 'Low', 'None'])
  // Any rating the module can produce must have a place in the summary order.
  const produced = new Set(
    [0, 1, 5, 7.5, 9.9].map(score => severityRating(score)),
  )
  for (const rating of produced) {
    assert.ok(SEVERITY_ORDER.includes(rating), `${rating} is orderable`)
  }
})
