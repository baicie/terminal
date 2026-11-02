import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEPENDENCY_CATEGORIES,
  PRODUCTION_CATEGORIES,
  flattenTree,
  keysOnlyIn,
  packageKey,
} from './license-inventory-tree.mjs'

test('packageKey keeps the version, so two versions stay two rows', () => {
  // Not cosmetic: argparse 1.x is MIT and argparse 2.x is Python-2.0. Collapsing
  // by name would make one of those licenses disappear from the inventory.
  assert.equal(packageKey('argparse', '2.0.1'), 'argparse@2.0.1')
  assert.notEqual(packageKey('argparse', '2.0.1'), packageKey('argparse', '1.0.10'))
  assert.equal(packageKey('seq-queue', undefined), 'seq-queue@unknown')
})

test('the walk is recursive, not just the root level', () => {
  // This is the regression that matters most. `pnpm list --json` nests to depth
  // 12 in this repo; a walker that reads only the root's map returns the direct
  // dependencies and presents them as the closure. The real case: elkjs (EPL-2.0)
  // sits four levels down under prisma, so a root-only walk reports no copyleft
  // at all - a false clean bill of health.
  const roots = [
    {
      name: 'team-server',
      version: '1.0.0',
      dependencies: {
        prisma: {
          version: '7.9.1',
          dependencies: {
            '@prisma/studio-core': {
              version: '0.1.0',
              dependencies: {
                elkjs: { version: '0.11.1', path: '/store/elkjs' },
              },
            },
          },
        },
      },
    },
  ]

  const closure = flattenTree(roots, { categories: PRODUCTION_CATEGORIES })

  assert.equal(closure.size, 3, 'prisma + studio-core + elkjs')
  assert.ok(closure.has('elkjs@0.11.1'), 'the deep transitive must be found')
  assert.deepEqual(closure.get('elkjs@0.11.1').chain, [
    'team-server@1.0.0',
    'prisma@7.9.1',
    '@prisma/studio-core@0.1.0',
    'elkjs@0.11.1',
  ])
})

test('every named category is followed, not just dependencies', () => {
  // The second under-reporting bug: nodes carry sibling category maps. Hardcoding
  // `dependencies` drops devDependencies entirely, which looks right under --prod
  // and is wrong everywhere else.
  const roots = [
    {
      name: 'frontend',
      version: '1.0.0',
      dependencies: { react: { version: '19.2.5' } },
      devDependencies: { vitest: { version: '4.0.0' } },
      optionalDependencies: { fsevents: { version: '2.3.3' } },
      unsavedDependencies: { tsx: { version: '4.21.0' } },
    },
  ]

  const prodOnly = flattenTree(roots, { categories: PRODUCTION_CATEGORIES })
  assert.deepEqual([...prodOnly.keys()].sort(), ['fsevents@2.3.3', 'react@19.2.5'])
  assert.ok(!prodOnly.has('vitest@4.0.0'), 'devDeps are not production')

  const everything = flattenTree(roots, { categories: DEPENDENCY_CATEGORIES })
  assert.equal(everything.size, 4)
  assert.ok(everything.has('vitest@4.0.0'))
  assert.ok(everything.has('tsx@4.21.0'))
})

test('categories must be passed explicitly', () => {
  // A default would reintroduce the silent-drop bug at the call site.
  const roots = [{ name: 'x', version: '1.0.0', dependencies: {} }]
  assert.throws(() => flattenTree(roots, {}), TypeError)
  assert.throws(() => flattenTree(roots, { categories: [] }), TypeError)
})

test('the shortest chain wins and extra roots are recorded', () => {
  // A package reachable from two workspace projects is one package with one
  // license, but "who pulled it in" should name both projects.
  const roots = [
    {
      name: 'a',
      version: '1.0.0',
      dependencies: {
        shared: { version: '2.0.0' },
        wrapper: { version: '1.0.0', dependencies: { shared: { version: '2.0.0' } } },
      },
    },
    {
      name: 'b',
      version: '1.0.0',
      dependencies: { shared: { version: '2.0.0' } },
    },
  ]

  const closure = flattenTree(roots, { categories: PRODUCTION_CATEGORIES })
  const shared = closure.get('shared@2.0.0')

  assert.deepEqual(shared.chain, ['a@1.0.0', 'shared@2.0.0'], 'direct beats nested')
  assert.deepEqual([...shared.roots].sort(), ['a@1.0.0', 'b@1.0.0'])
})

test('a deduped occurrence must not hide the expanded one', () => {
  // The bug this guards is the one that actually produced a wrong answer here.
  //
  // `pnpm list --json` prints a package's children only once. Every later
  // occurrence of the same package is abbreviated with `deduped: true` and no
  // `dependencies` map. In this repo 539 of 1164 nodes are such stubs.
  //
  // A walk that records each key once and only descends into that first
  // occurrence will, whenever the stub comes first in breadth-first order,
  // traverse the childless copy and never see the subtree. That is exactly how
  // elkjs (EPL-2.0, four levels under prisma) disappeared: team-server listed
  // `prisma` as a direct dependency (deduped stub, no children) and again under
  // `@prisma/client` (expanded, with children). The stub won, and the closure
  // came out 58 packages with "no copyleft" instead of 274 packages with one.
  //
  // So children must be merged from every occurrence of a key, not just the
  // first one reached.
  const roots = [
    {
      name: 'team-server',
      version: '1.0.0',
      dependencies: {
        // Shallower, but abbreviated: this is the one BFS reaches first.
        prisma: { version: '7.9.1', deduped: true },
        '@prisma/client': {
          version: '7.9.1',
          dependencies: {
            // Deeper, and the only occurrence carrying the subtree.
            prisma: {
              version: '7.9.1',
              dependencies: {
                elkjs: { version: '0.11.1', path: '/store/elkjs' },
              },
            },
          },
        },
      },
    },
  ]

  const closure = flattenTree(roots, { categories: PRODUCTION_CATEGORIES })

  assert.ok(
    closure.has('elkjs@0.11.1'),
    'a subtree hanging off the expanded occurrence must still be walked',
  )
  // The shortest chain is still reported for the package itself.
  assert.deepEqual(closure.get('prisma@7.9.1').chain, ['team-server@1.0.0', 'prisma@7.9.1'])
})

test('cycles terminate', () => {
  const a = { version: '1.0.0' }
  const b = { version: '1.0.0', dependencies: { a } }
  a.dependencies = { b }

  const closure = flattenTree([{ name: 'root', version: '1.0.0', dependencies: { a } }], {
    categories: PRODUCTION_CATEGORIES,
  })

  assert.deepEqual([...closure.keys()].sort(), ['a@1.0.0', 'b@1.0.0'])
})

test('malformed and empty payloads yield an empty closure, not a throw', () => {
  const cats = { categories: PRODUCTION_CATEGORIES }
  assert.equal(flattenTree([], cats).size, 0)
  assert.equal(flattenTree(null, cats).size, 0)
  assert.equal(flattenTree([null, 'nope'], cats).size, 0)
  // A node whose category value is a string, not a map.
  assert.equal(flattenTree([{ name: 'r', version: '1', dependencies: 'x' }], cats).size, 0)
})

test('keysOnlyIn isolates dev-only packages', () => {
  // How "MPL-2.0 appears in the tree" is separated from "MPL-2.0 ships".
  const all = new Map([
    ['react@19', {}],
    ['mpl-pkg@1', {}],
  ])
  const prod = new Map([['react@19', {}]])

  assert.deepEqual(keysOnlyIn(all, prod), ['mpl-pkg@1'])
  assert.deepEqual(keysOnlyIn(prod, all), [])
})
