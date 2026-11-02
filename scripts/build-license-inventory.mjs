#!/usr/bin/env node
/**
 * Build the frontend/team-server license inventory for
 * docs/phase9-1/frontend-dependency-audit.md.
 *
 * Why this exists: `pnpm licenses list --prod --json` fails on this checkout
 * (ERR_PNPM_MISSING_PACKAGE_INDEX_FILE, a store-index problem, not a network
 * one), so the license column was recorded as NOT_RUN. But the data does not
 * need the registry: every installed package carries its own license field in
 * its package.json on disk. This script walks the production closure that
 * `pnpm list` reports and reads those files.
 *
 * Two properties are deliberate, both learned from getting it wrong by hand:
 *
 *   - The closure is taken from the real `pnpm list --json` tree, which nests
 *     recursively (depth 12 on this repo) and splits siblings across
 *     dependencies / devDependencies / optionalDependencies. A walker that
 *     reads only the top level, or only `dependencies`, silently undercounts.
 *     license-inventory-tree.mjs owns that traversal and is tested against
 *     both mistakes.
 *   - "No license field" is reported as ABSENT, never folded into the
 *     permissive pile. An unknown license is an open question, not a pass.
 *
 * Inputs are passed explicitly and never defaulted to a stale snapshot: a
 * license inventory that silently describes last week's dependency tree is
 * worse than no inventory.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Row construction lives in its own module: this file is the CLI around it.
// Re-exported so existing callers (and the tests) keep importing them here.
import {
  buildInventory,
  buildRoot,
  distribution,
  flagged,
  NO_LICENSE_FIELD,
} from './license-inventory-rows.mjs'

export {
  buildInventory,
  buildRoot,
  distribution,
  flagged,
  NO_LICENSE_FIELD,
  buildRows,
  readPackageLicense,
} from './license-inventory-rows.mjs'

import { parseListJson } from './license-inventory-tree.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = join(ROOT, 'docs/phase9-1')

export const PROD_COMMAND =
  'pnpm -r list --prod --depth Infinity --json > "$TMPDIR/prod-tree.json"'
export const ALL_COMMAND =
  'pnpm -r list --depth Infinity --json > "$TMPDIR/all-tree.json"'

const HOW_TO_PRODUCE = [
  'This script does not guess an input path and does not fall back to a stale',
  'dependency tree: an inventory that describes an outdated closure is worse',
  'than no inventory.',
  '',
  'Produce both trees, then pass them explicitly:',
  '',
  '  ' + PROD_COMMAND,
  '  ' + ALL_COMMAND,
  '  node scripts/build-license-inventory.mjs \\',
  '    --prod "$TMPDIR/prod-tree.json" --all "$TMPDIR/all-tree.json"',
  '',
  'The --all tree is only used to separate dev-only packages from production',
  'ones. Omit it and every package is reported without that distinction.',
].join('\n')

export const MISSING_INPUT_MESSAGE =
  'No production dependency tree given.\n\n' + HOW_TO_PRODUCE

export function treeNotFoundMessage(input) {
  return `dependency tree not found: ${input}\n\n${HOW_TO_PRODUCE}`
}

/** Parse argv. Returns explicit paths, or null for each when absent. */
export function parseArgs(argv) {
  const out = { prod: null, all: null, json: null }
  const take = (key, arg, index) => {
    if (arg === `--${key}`) {
      out[key] = argv[index + 1] ?? null
      return 1
    }
    if (arg.startsWith(`--${key}=`)) {
      out[key] = arg.slice(key.length + 3)
      return 0
    }
    return -1
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    let matched = false
    for (const key of ['prod', 'all', 'json']) {
      const step = take(key, arg, index)
      if (step >= 0) {
        index += step
        matched = true
        break
      }
    }
    if (!matched && !arg.startsWith('-') && out.prod === null) out.prod = arg
  }
  return out
}

/**
 * Read one package's declared license off disk.
 *
 * A package in the closure whose package.json cannot be read is reported as
 * unreadable rather than skipped. Skipping would shrink the denominator and
 * make the inventory look more complete than it is.
 */

/**
 * Strip this machine out of the serialized form.
 *
 * Two changes, both so the artifact is checkable by someone else:
 *   - store paths relative to the repo root, since an absolute
 *     /Users/<name>/... path makes the file differ per machine and leaks a
 *     home directory into a committed document, and
 *   - replace each `flagged` bucket with the package keys it holds, because
 *     embedding whole row objects a second time multiplied the file size for
 *     no added fact: every key indexes straight into `rows`.
 */
export function serializeRoot(root, repoRoot = ROOT) {
  const relative = row => ({
    ...row,
    path: row.path?.startsWith(repoRoot)
      ? row.path.slice(repoRoot.length).replace(/^\/+/, '')
      : row.path,
  })
  const keysOf = bucket => Object.fromEntries(
    Object.entries(bucket).map(([label, rows]) => [label, rows.map(r => r.key)]),
  )
  // `flagged` holds row keys rather than copies of the row objects: the rows
  // are already in `rows`, and duplicating them doubled the file for no
  // information.
  const section = (part, { rowsIncluded }) => {
    const flagged = keysOf(part.flagged)
    const keep =
      rowsIncluded === 'all'
        ? part.rows
        : part.rows.filter(row => Object.values(flagged).some(keys => keys.includes(row.key)))

    return {
      total: part.total,
      // Computed over every row in the closure, including rows not listed
      // below, so the counts stay checkable against `total`.
      distribution: part.distribution,
      flagged,
      rowsIncluded,
      rows: keep.map(relative),
    }
  }

  return {
    name: root.name,
    version: root.version,
    // Production is the compliance surface, so every row is listed.
    prod: section(root.prod, { rowsIncluded: 'all' }),
    // Dev-only packages are build tooling that is not distributed. Listing all
    // 899 of them added ~440 KB of MIT build tools; only the rows a human has
    // to look at are kept. `total` and `distribution` still cover the whole
    // dev closure, and the full listing is reproducible with the two commands
    // recorded at the top of this file.
    dev: section(root.dev, { rowsIncluded: 'flagged-only' }),
  }
}

function main(argv) {
  const { prod, all, json } = parseArgs(argv)
  if (!prod) {
    process.stderr.write(MISSING_INPUT_MESSAGE + '\n')
    process.exit(2)
  }
  if (!existsSync(prod)) {
    process.stderr.write(treeNotFoundMessage(prod) + '\n')
    process.exit(2)
  }
  if (all && !existsSync(all)) {
    process.stderr.write(treeNotFoundMessage(all) + '\n')
    process.exit(2)
  }

  const inventory = buildInventory(
    readFileSync(prod, 'utf8'),
    all ? readFileSync(all, 'utf8') : '[]',
  )

  mkdirSync(OUT_DIR, { recursive: true })
  const target = json ?? join(OUT_DIR, 'frontend-license-inventory.json')
  writeFileSync(
    target,
    JSON.stringify(
      {
        generatedBy: 'scripts/build-license-inventory.mjs',
        prodCommand: PROD_COMMAND,
        allCommand: ALL_COMMAND,
        // Which files this run actually read. Named so a reader can tell a
        // full run (both trees) from a production-only one, where the
        // dev-only column is empty because it was never measured.
        inputs: { prod, all: all ?? null },
        method:
          'Licenses are read from each installed package.json in the closure ' +
          '(license, falling back to the deprecated licenses array). SPDX ' +
          'expressions are resolved by scripts/license-classify.mjs: an OR ' +
          'branch free of copyleft makes the obligation avoidable, AND binds ' +
          'every term. No network access is involved.',
        roots: inventory.map(root => serializeRoot(root)),
      },
      null,
      2,
    ) + '\n',
  )

  for (const root of inventory) {
    const f = root.prod.flagged
    process.stdout.write(
      `${root.name}@${root.version}: prod ${root.prod.total} | ` +
        `copyleft ${f.strongCopyleft.length} strong / ${f.weakCopyleft.length} weak | ` +
        `unknown ${f.unknown.length} | dev-only ${root.dev.total}\n`,
    )
  }
  process.stdout.write(`wrote ${target}\n`)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
}
