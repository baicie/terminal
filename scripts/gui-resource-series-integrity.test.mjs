// DDQ03 — the sampler's holes must reach the rule that refuses holes.
//
// ## The defect this pins, measured on run 45937332982
//
// `e2e-09` did:
//
//     const rss = samples.map(s => s.rssBytes).filter(v => v !== null)
//     const rssCurve = summariseSeries(rss, LIMITS)
//
// `resource-curve.mjs` has a test named "refuses a series with a hole in it" — the rule
// was written to reject a series containing a null. The spec removed every null first, so
// the rule never saw one. Nothing failed; an almost-unmeasured run was summarised as a
// curve.
//
// This is the same family as the credential guard that sat after an early `return`: the
// guard exists, it has tests, and the production path never reaches it. A unit test on the
// rule cannot catch that, because the rule is fine. The defect is in the caller, so the
// assertion has to be about the caller's source.
//
// ## Why a source-level test
//
// Running the GUI suite to observe the artifact would take 30 minutes and would only
// happen after the bug had already produced a green job. The rule is about how the spec
// builds its series, so it is checked against the spec's source — the same approach
// `gui-spec-tab-identity.test.mjs` and `terminal-route-literal-guard.test.mjs` take.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const SPEC = path.join(ROOT, 'e2e/gui/specs/e2e-09-resource-curve.e2e.mjs')
const SERIES = path.join(ROOT, 'e2e/gui/fixtures/resource-series.mjs')
const CURVE = path.join(ROOT, 'e2e/gui/fixtures/resource-curve.mjs')

const spec = readFileSync(SPEC, 'utf8')
const series = readFileSync(SERIES, 'utf8')
const curve = readFileSync(CURVE, 'utf8')

/**
 * The spec with its comments removed.
 *
 * The file documents the defect it used to have, and that explanation quotes
 * `.filter(v => v !== null)`. Matching the comment would fail on the documentation of the
 * fix — but stripping comments has to be done precisely, because a stripper that is too
 * eager (one that also eats code after a `//` inside a string) would make the guard
 * vacuous, which is the failure mode `vacuous-guard-passes-on-broken-code` names.
 *
 * Only block comments are removed. The spec uses `//` solely for whole-line comments, and
 * a line-anchored rule keeps a `//` inside a regular expression or URL from truncating
 * anything.
 */
const specCode = spec
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !/^\s*\/\//.test(line))
  .join('\n')

describe('DDQ03 — the curve judge is not fed a compacted array', () => {
  it('the spec does not strip nulls before calling summariseSeries', () => {
    /*
     * Both halves are checked: a filter anywhere on the way to the rule re-opens the
     * bypass, whatever it is spelled like. `filter(Boolean)` is the same bug with fewer
     * characters.
     */
    const filterPattern = /\.filter\(\s*(?:v|value|sample)?\s*=>\s*[^)]*!==\s*null/
    assert.ok(
      !filterPattern.test(specCode),
      'e2e-09 must not filter nulls out of a metric series: that is exactly what let a ' +
        '12-of-100 run be summarised as a curve. Build the series with resource-series.mjs ' +
        'and let summariseSeries see the holes.',
    )
  })

  it('builds the series through buildSeries, not by mapping raw samples', () => {
    assert.match(
      spec,
      /buildSeries\(/,
      'the series must carry its round indices; a bare `samples.map(...)` loses them',
    )
    assert.match(
      spec,
      /completenessProblems\(/,
      'completeness must be judged before any trend is computed',
    )
  })

  it('pushes the baseline into the series, not only into a local', () => {
    /*
     * Measured on the second local run: the spec read `series.baseline.rssBytes` while the
     * baseline had only ever been assigned to `measured.baseline` and never added to the
     * samples array, so the artifact said `rssBaseline: null`. That is worse than a missing
     * field: it reads as "the sampler could not read a baseline", which is a different
     * finding from "the baseline was read and then dropped on the floor".
     *
     * The rule: if the spec reads `series.baseline`, something must push `round: -1` **into
     * the samples array**. Matching `round: -1` anywhere is not enough: the first version of
     * this guard passed on `measured.baseline = { round: -1, … }`, which is precisely the
     * line that was present while the field was null. The push is what `buildSeries` reads.
     */
    if (/series\.baseline/.test(specCode)) {
      assert.match(
        specCode,
        /samples\.push\(\s*\{\s*round:\s*-1/,
        'the spec reads series.baseline but never pushes a { round: -1 } sample into ' +
          '`samples`, so the field it reads is always null — assigning it to a local is ' +
          'not enough, because buildSeries only sees the array',
      )
    }
  })

  it('records whether every sample came from the same process', () => {
    /*
     * DDQ07 asks this by name, and the first version of the spec could not answer it: the
     * `pidChanges` field was only written when a change **happened**, so a clean run
     * carried no field and a reader could not tell "no change" from "not checked".
     *
     * The field has to be unconditional, and a false answer has to keep the run out of
     * PASS — a series stitched from two processes describes neither, because the second
     * process's baseline is not the first's.
     */
    // The assignment, not a read: `measured.sameProcess === false` also matches the loose
    // form, and a guard satisfied by a read is satisfied by the code that fails without it.
    assert.match(
      specCode,
      /measured\.sameProcess\s*=[^=]/,
      'sameProcess must be assigned every run',
    )
    /*
     * And it has to reach the artifact. Measured while writing this: the value was
     * computed in the case body and read in `after()`, but never copied into `extra`, so
     * the evidence file could not answer the question the spec had already answered for
     * itself. A field that is computed and dropped is the same as one never computed —
     * from the reader's side they are indistinguishable.
     */
    assert.match(
      specCode,
      /sameProcess: measured\.sameProcess/,
      'sameProcess must be copied into the evidence, not only computed',
    )
    /*
     * The verdict branch has to *use* it. `identityLost` alone is satisfied by the
     * declaration, so the check is that the variable appears inside the `INSUFFICIENT_DATA`
     * condition — measured: the first version of this guard passed with the assignment
     * deleted, because the declaration was still there.
     */
    const verdictStart = specCode.indexOf('let verdict')
    assert.ok(verdictStart > -1, 'could not find the verdict decision')
    const verdictBlock = specCode.slice(verdictStart, verdictStart + 600)
    assert.match(
      verdictBlock,
      /identityLost/,
      'identityLost must appear in the verdict decision, not only in a declaration',
    )
    assert.match(
      verdictBlock,
      /INSUFFICIENT_DATA/,
      'a run whose samples cross a pid change must be INSUFFICIENT_DATA',
    )
  })

  it('every metric the spec reads is one it asked buildSeries for', () => {
    /*
     * Measured on a local 15-round run of the first version: `after()` read
     * `series.values.threads` while `buildSeries` had only been asked for
     * `['rssBytes', 'openFds']`, so the hook threw `series.values.threads is not iterable`
     * and the case reported "1 passing / 1 failing" — the case passed, the evidence write
     * did not, and no evidence file was produced at all.
     *
     * That is a whole class of defect: a `values.<metric>` read is a lookup with no
     * compile-time check behind it, and a missing key is `undefined` rather than an error
     * until something iterates it. The list passed to `buildSeries` and the keys read from
     * `series.values` therefore have to agree, and this is the assertion that makes them.
     */
    const asked = /buildSeries\(\s*samples\s*,\s*\[([^\]]*)\]/.exec(specCode)
    assert.ok(asked, 'could not find the buildSeries metric list in the spec')
    const requested = asked[1]
      .split(',')
      .map(name => name.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)

    const read = [...specCode.matchAll(/series\.values\.(\w+)/g)].map(match => match[1])
    assert.ok(read.length > 0, 'the spec never reads series.values, so this guard is vacuous')

    for (const metric of new Set(read)) {
      assert.ok(
        requested.includes(metric),
        `the spec reads series.values.${metric} but only asked buildSeries for ` +
          `[${requested.join(', ')}] — that read is undefined at runtime and throws when ` +
          'iterated, after the case has already passed',
      )
    }
  })

  it('the rule still refuses a hole, so the guard it relies on is intact', () => {
    /*
     * If someone "fixes" this by making `summariseSeries` tolerate nulls, the spec-side
     * rule above becomes decorative. The refusal is the contract; this test fails if it
     * is relaxed.
     */
    assert.match(
      curve,
      /not numbers/,
      'summariseSeries must still refuse a series containing non-numbers',
    )
  })
})

describe('DDQ03 — completeness is a first-class result', () => {
  it('the series module exposes coverage and the longest gap separately', () => {
    /*
     * A total count cannot distinguish ten scattered misses from a ten-round hole, and the
     * two are not the same measurement: a curve drawn across the hole joins samples that
     * are not adjacent in time.
     */
    for (const field of [
      'perMetricValidSamples',
      'maximumConsecutiveMissing',
      'missingRounds',
      'unavailableReasons',
    ]) {
      assert.match(series, new RegExp(field), `resource-series must expose ${field}`)
    }
  })

  it('a run that stopped early is not silently a shorter complete run', () => {
    // The measurement: `expectedSamples` must be carried independently of the array
    // length, or "60 observed of 100 asked" reads as a complete run of 60.
    assert.match(
      series,
      /expectedSamples/,
      'the expected sample count has to come from the caller, not from samples.length',
    )
    assert.match(
      series,
      /expectedSamples - list\.length|list\.length < expectedSamples/,
      'rounds the run never reached must still be counted as missing',
    )
  })
})
