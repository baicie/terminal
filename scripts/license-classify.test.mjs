import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyExpression,
  classifyTerm,
  readDeclaredLicense,
  splitTopLevel,
} from './license-classify.mjs'

test('single identifiers land in the right category', () => {
  for (const id of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'Python-2.0']) {
    assert.equal(classifyTerm(id), 'permissive', id)
  }
  for (const id of ['GPL-3.0', 'AGPL-3.0', 'AGPL-3.0-only', 'SSPL-1.0', 'GPL-2.0+']) {
    assert.equal(classifyTerm(id), 'strong-copyleft', id)
  }
  // The two weak-copyleft identifiers actually present in this repo's trees.
  for (const id of ['LGPL-3.0', 'MPL-2.0', 'EPL-2.0', 'CDDL-1.0']) {
    assert.equal(classifyTerm(id), 'weak-copyleft', id)
  }
})

test('an unrecognized identifier is unknown, never permissive', () => {
  // The safety property: a license nobody taught this module about must surface
  // for a human rather than quietly counting as fine.
  assert.equal(classifyTerm('Weird-Corp-EULA-1.0'), 'unknown')
  assert.equal(classifyTerm(''), 'unknown')
})

test('WITH exceptions and "or later" classify on the license family', () => {
  assert.equal(classifyTerm('GPL-2.0-only WITH Classpath-exception-2.0'), 'strong-copyleft')
  assert.equal(classifyTerm('LGPL-2.1+'), 'weak-copyleft')
})

test('OR makes copyleft avoidable; AND does not', () => {
  // This pair is the reason the module parses instead of substring-matching.
  // Both strings contain "GPL-3.0"; only one actually binds us.
  const or = classifyExpression('MIT OR GPL-3.0')
  assert.equal(or.effective, 'permissive')
  assert.deepEqual(or.copyleftNamed, ['GPL-3.0'])
  assert.equal(or.avoidable, true)

  const and = classifyExpression('MIT AND GPL-3.0')
  assert.equal(and.effective, 'strong-copyleft')
  assert.deepEqual(and.copyleftNamed, ['GPL-3.0'])
  assert.equal(and.avoidable, false)
})

test('dual-permissive expressions in this repo resolve to permissive', () => {
  // The 8 "MIT OR Apache-2.0" and 2 "Apache-2.0 OR MIT" rows in the frontend
  // production closure.
  assert.equal(classifyExpression('MIT OR Apache-2.0').effective, 'permissive')
  assert.equal(classifyExpression('Apache-2.0 OR MIT').effective, 'permissive')
  assert.equal(classifyExpression('(MIT OR CC0-1.0)').effective, 'permissive')
  // @visx/vendor's "MIT and ISC" - lowercase operator, both permissive anyway.
  assert.equal(classifyExpression('MIT and ISC').effective, 'permissive')
})

test('parentheses are respected when splitting', () => {
  assert.deepEqual(splitTopLevel('(MIT OR GPL-3.0) AND ISC', 'AND'), ['(MIT OR GPL-3.0)', 'ISC'])
  // Splitting the same string on OR must not reach inside the parentheses.
  assert.deepEqual(splitTopLevel('(MIT OR GPL-3.0) AND ISC', 'OR'), ['(MIT OR GPL-3.0) AND ISC'])
})

test('a nested OR inside an AND still resolves', () => {
  // "(MIT OR GPL-3.0) AND ISC": take MIT from the branch, so permissive.
  const result = classifyExpression('(MIT OR GPL-3.0) AND ISC')
  assert.equal(result.effective, 'permissive')
  assert.deepEqual(result.copyleftNamed, ['GPL-3.0'])

  // No escape from the copyleft term here.
  assert.equal(classifyExpression('(MIT AND GPL-3.0) OR AGPL-3.0').effective, 'strong-copyleft')
})

test('the weakest OR branch wins, not the first one listed', () => {
  assert.equal(classifyExpression('GPL-3.0 OR MIT').effective, 'permissive')
  // Weak beats strong when both are offered.
  assert.equal(classifyExpression('AGPL-3.0 OR MPL-2.0').effective, 'weak-copyleft')
})

test('absent and unparseable licenses are distinguished from permissive', () => {
  assert.equal(classifyExpression(null).effective, 'absent')
  assert.equal(classifyExpression('').effective, 'absent')
  assert.equal(classifyExpression(undefined).effective, 'absent')
  // Free text that needs a human to open the file.
  assert.equal(classifyExpression('SEE LICENSE IN LICENSE.md').effective, 'unknown')
  assert.equal(classifyExpression('UNLICENSED').effective, 'unknown')
})

test('readDeclaredLicense prefers license, falls back to the deprecated array', () => {
  assert.deepEqual(readDeclaredLicense({ license: 'MIT' }), {
    expression: 'MIT',
    source: 'license',
  })

  // busboy@1.6.0 and streamsearch@1.1.0 in the team-server production closure
  // have no `license` field at all, only this deprecated array. Without the
  // fallback both would be reported as "no license", which is wrong: the array
  // says MIT and the LICENSE file is there.
  assert.deepEqual(
    readDeclaredLicense({
      licenses: [{ type: 'MIT', url: 'http://github.com/mscdex/busboy/raw/master/LICENSE' }],
    }),
    { expression: 'MIT', source: 'licenses[]' }
  )

  // Object form of the singular field.
  assert.deepEqual(readDeclaredLicense({ license: { type: 'ISC' } }), {
    expression: 'ISC',
    source: 'license.type',
  })

  // Genuinely absent: seq-queue@0.0.5 has neither field.
  assert.deepEqual(readDeclaredLicense({ name: 'seq-queue', version: '0.0.5' }), {
    expression: null,
    source: 'absent',
  })
  assert.deepEqual(readDeclaredLicense({}), { expression: null, source: 'absent' })

  // An empty string is absent, not an empty permissive license.
  assert.deepEqual(readDeclaredLicense({ license: '   ' }), {
    expression: null,
    source: 'absent',
  })
})

test('multiple entries in the deprecated array are read as alternatives', () => {
  const result = readDeclaredLicense({ licenses: [{ type: 'MIT' }, { type: 'GPL-3.0' }] })
  assert.equal(result.expression, 'MIT OR GPL-3.0')
  // And the OR semantics then apply, so this is not a copyleft obligation.
  assert.equal(classifyExpression(result.expression).effective, 'permissive')
})
