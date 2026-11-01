import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseArgs,
  readPackageLicense,
  buildRows,
  distribution,
  flagged,
  buildRoot,
  buildInventory,
  serializeRoot,
  MISSING_INPUT_MESSAGE,
  treeNotFoundMessage,
  PROD_COMMAND,
} from './build-license-inventory.mjs'
import { ABSENT, STRONG, WEAK, UNKNOWN } from './license-classify.mjs'

/**
 * A fake filesystem: maps a package directory to the package.json text it
 * contains. Reading an unlisted directory throws, which is how the real
 * readFileSync behaves for a missing optional platform package.
 */
function fakeReader(files) {
  return path => {
    if (!(path in files)) throw new Error(`ENOENT ${path}`)
    return files[path]
  }
}

test('parseArgs accepts --prod, --all and --json in both syntaxes', () => {
  assert.deepEqual(parseArgs(['--prod', 'p.json', '--all', 'a.json']), {
    prod: 'p.json',
    all: 'a.json',
    json: null,
  })
  assert.deepEqual(parseArgs(['--prod=p.json', '--json=out.json']), {
    prod: 'p.json',
    all: null,
    json: 'out.json',
  })
  // A bare path is the production tree, matching the Rust ledger's behaviour.
  assert.equal(parseArgs(['tree.json']).prod, 'tree.json')
  assert.deepEqual(parseArgs([]), { prod: null, all: null, json: null })
})

test('both input failures name the command that produces the input', () => {
  // The two failure modes a reader actually hits. Neither may leave them
  // guessing how to generate the tree.
  for (const message of [MISSING_INPUT_MESSAGE, treeNotFoundMessage('/x.json')]) {
    assert.ok(message.includes(PROD_COMMAND))
  }
  assert.ok(treeNotFoundMessage('/x.json').includes('/x.json'))
})

test('an unreadable package.json is reported, never silently dropped', () => {
  // The 31 optional platform binaries in this repo (lightningcss-win32-*,
  // @tailwindcss/oxide-*) are in the tree but not installed on macOS.
  // Dropping them would shrink the denominator and overstate completeness.
  const result = readPackageLicense('/pkg/absent', fakeReader({}))
  assert.equal(result.unreadable, true)
  // No license string at all, and the reason recorded: not an empty string
  // that a later table could render as a blank cell and a reader could skim
  // past as "nothing to see".
  assert.equal(result.declared, null)
  assert.equal(result.source, ABSENT)

  const ok = readPackageLicense(
    '/pkg/ok',
    fakeReader({ '/pkg/ok/package.json': '{"license":"MIT"}' }),
  )
  assert.deepEqual(ok, { declared: 'MIT', source: 'license', unreadable: false })

  // A node with no path at all cannot be read either.
  assert.equal(readPackageLicense(null, fakeReader({})).unreadable, true)
})

test('buildRows reads licenses off disk and marks dev-only packages', () => {
  const closure = new Map([
    ['b@1.0.0', { name: 'b', version: '1.0.0', path: '/n/b', chain: [] }],
    ['a@1.0.0', { name: 'a', version: '1.0.0', path: '/n/a', chain: [] }],
  ])
  const rows = buildRows(closure, {
    devOnlyKeys: new Set(['b@1.0.0']),
    reader: fakeReader({
      '/n/a/package.json': '{"license":"MIT"}',
      '/n/b/package.json': '{"license":"MPL-2.0"}',
    }),
  })

  // Sorted by key, so a regenerated report diffs cleanly.
  assert.deepEqual(rows.map(r => r.key), ['a@1.0.0', 'b@1.0.0'])
  assert.equal(rows[0].devOnly, false)
  assert.equal(rows[1].devOnly, true)
  assert.equal(rows[1].category, WEAK)
})

test('distribution counts descending and is stable for equal counts', () => {
  const rows = [
    { declared: 'MIT' },
    { declared: 'MIT' },
    { declared: 'ISC' },
    { declared: 'Apache-2.0' },
  ]
  assert.deepEqual(distribution(rows), [
    { license: 'MIT', count: 2 },
    // Equal counts fall back to alphabetical order rather than insertion order.
    { license: 'Apache-2.0', count: 1 },
    { license: 'ISC', count: 1 },
  ])
})

test('flagged separates strong copyleft, weak copyleft and unknown', () => {
  const rows = buildRows(
    new Map([
      ['agpl@1.0.0', { name: 'agpl', version: '1.0.0', path: '/n/agpl' }],
      ['epl@1.0.0', { name: 'epl', version: '1.0.0', path: '/n/epl' }],
      ['none@1.0.0', { name: 'none', version: '1.0.0', path: '/n/none' }],
      ['mit@1.0.0', { name: 'mit', version: '1.0.0', path: '/n/mit' }],
    ]),
    {
      reader: fakeReader({
        '/n/agpl/package.json': '{"license":"AGPL-3.0"}',
        '/n/epl/package.json': '{"license":"EPL-2.0"}',
        '/n/none/package.json': '{"name":"none"}',
        '/n/mit/package.json': '{"license":"MIT"}',
      }),
    },
  )
  const f = flagged(rows)

  assert.deepEqual(f.strongCopyleft.map(r => r.name), ['agpl'])
  assert.deepEqual(f.weakCopyleft.map(r => r.name), ['epl'])
  // A missing license field is an open question, not a permissive default.
  assert.deepEqual(f.unknown.map(r => r.name), ['none'])
  assert.equal(f.unreadable.length, 0)
})

test('buildRoot separates the production closure from dev-only packages', () => {
  // The distinction the whole report turns on: the same copyleft package is a
  // different finding depending on which closure it sits in.
  const prodRoot = {
    name: 'app',
    version: '1.0.0',
    path: '/app',
    dependencies: { runtime: { version: '1.0.0', path: '/n/runtime' } },
  }
  const allRoot = {
    name: 'app',
    version: '1.0.0',
    path: '/app',
    dependencies: { runtime: { version: '1.0.0', path: '/n/runtime' } },
    devDependencies: { buildtool: { version: '2.0.0', path: '/n/buildtool' } },
  }
  const reader = fakeReader({
    '/n/runtime/package.json': '{"license":"MIT"}',
    '/n/buildtool/package.json': '{"license":"MPL-2.0"}',
  })

  const root = buildRoot(prodRoot, [allRoot], reader)
  assert.equal(root.prod.total, 1)
  assert.equal(root.prod.flagged.weakCopyleft.length, 0)
  assert.equal(root.dev.total, 1)
  assert.deepEqual(root.dev.flagged.weakCopyleft.map(r => r.name), ['buildtool'])
})

test('buildRoot with no matching full tree reports production only', () => {
  // Running without --all must not invent dev-only packages.
  const root = buildRoot(
    {
      name: 'app',
      version: '1.0.0',
      dependencies: { runtime: { version: '1.0.0', path: '/n/runtime' } },
    },
    [],
    fakeReader({ '/n/runtime/package.json': '{"license":"MIT"}' }),
  )
  assert.equal(root.prod.total, 1)
  assert.equal(root.dev.total, 0)
})

test('buildInventory drops empty roots and keeps populated ones', () => {
  // The monorepo root has zero production dependencies of its own; a row for
  // it would just be noise.
  const prod = JSON.stringify([
    { name: 'empty-root', version: '1.0.0' },
    {
      name: 'app',
      version: '1.0.0',
      dependencies: { runtime: { version: '1.0.0', path: '/n/runtime' } },
    },
  ])
  const inventory = buildInventory(prod, '[]', fakeReader({}))
  assert.deepEqual(inventory.map(r => r.name), ['app'])
})

test('a conjunctive AND license is flagged for review', () => {
  // "MIT and ISC" obliges both licences at once; it is not a choice, so it is
  // worth a human read even though both halves are permissive.
  const rows = buildRows(
    new Map([['x@1.0.0', { name: 'x', version: '1.0.0', path: '/n/x' }]]),
    { reader: fakeReader({ '/n/x/package.json': '{"license":"MIT and ISC"}' }) },
  )
  assert.equal(rows[0].conjunctive, true)
  assert.deepEqual(flagged(rows).conjunctive.map(r => r.name), ['x'])
})

test('serializeRoot makes paths repo-relative and flagged a key list', () => {
  // Two reasons the serialized shape differs from the in-memory one:
  //
  //   - absolute store paths bake this machine's home directory into a
  //     committed artifact, so the same tree would serialize differently on
  //     CI and the diff would be noise rather than a dependency change;
  //   - `flagged` holds the same row objects as `rows`, so writing both
  //     verbatim duplicates every flagged row (that duplication was most of
  //     a 1.2 MB file). Keys reference the rows instead.
  const root = buildRoot(
    {
      name: 'app',
      version: '1.0.0',
      dependencies: { epl: { version: '1.0.0', path: '/repo/node_modules/.pnpm/epl/x' } },
    },
    [],
    fakeReader({ '/repo/node_modules/.pnpm/epl/x/package.json': '{"license":"EPL-2.0"}' }),
  )

  const serialized = serializeRoot(root, '/repo')

  assert.equal(serialized.prod.rows[0].path, 'node_modules/.pnpm/epl/x')
  assert.deepEqual(serialized.prod.flagged.weakCopyleft, ['epl@1.0.0'])
  // The row itself is still present in full; only the flagged lists are keys.
  assert.equal(serialized.prod.rows[0].declared, 'EPL-2.0')
  assert.equal(serialized.prod.total, 1)
})

test('serializeRoot leaves a path outside the repo untouched', () => {
  // A linked dependency can resolve outside the checkout. Slicing a prefix it
  // does not have would corrupt the path, so it is left absolute.
  const root = buildRoot(
    {
      name: 'app',
      version: '1.0.0',
      dependencies: { ext: { version: '1.0.0', path: '/elsewhere/ext' } },
    },
    [],
    fakeReader({ '/elsewhere/ext/package.json': '{"license":"MIT"}' }),
  )

  assert.equal(serializeRoot(root, '/repo').prod.rows[0].path, '/elsewhere/ext')
})
