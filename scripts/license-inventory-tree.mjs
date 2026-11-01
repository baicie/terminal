#!/usr/bin/env node
/**
 * Walk a `pnpm list --json` tree into a flat package closure with dependency
 * chains.
 *
 * This module exists because the obvious one-liner is wrong in two ways that
 * both produce a plausible-looking number:
 *
 *   - `pnpm list --json` nests recursively (observed depth 12 in this repo), so
 *     a walker that reads only the root's `dependencies` map reports the direct
 *     dependencies and calls them the closure. Here that is 17 instead of 256.
 *   - each node carries up to four sibling category maps (`dependencies`,
 *     `devDependencies`, `optionalDependencies`, `unsavedDependencies`). A
 *     walker that hardcodes `dependencies` silently drops the others; under
 *     `--prod` that looks correct, and without `--prod` it hides every devDep.
 *
 * Both failures under-report, which is the dangerous direction for an audit: a
 * missed package is a license nobody reviewed. So the categories to traverse are
 * an explicit argument, never a default guess, and `pnpm` itself decides what is
 * production by being invoked with `--prod` - this module does not re-derive
 * production-ness from package.json.
 */

/**
 * Dependency category keys a `pnpm list --json` node may carry.
 *
 * `unsavedDependencies` holds packages present in node_modules but not declared
 * in package.json (in this repo: workspace-root tools linked into the package).
 * It is listed here so callers can name it, not because it belongs in every
 * traversal.
 */
export const DEPENDENCY_CATEGORIES = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'unsavedDependencies',
]

/** The production closure: what ships. `--prod` already excluded devDeps. */
export const PRODUCTION_CATEGORIES = ['dependencies', 'optionalDependencies']

/** Stable identity of a resolved package. Version matters: two versions of one
 * package can carry two different licenses. */
export function packageKey(name, version) {
  return `${name}@${version ?? 'unknown'}`
}

/**
 * Flatten a `pnpm list --json` payload into a Map of packageKey -> record.
 *
 * Each record keeps the shortest dependency chain that reaches the package,
 * because "who pulled this in" is the question a copyleft finding immediately
 * raises. Shortest-first is why this is a breadth-first walk rather than a
 * recursive descent.
 *
 * The subtlety that decides whether the closure is complete: `pnpm list` prints
 * a package's children only at ONE occurrence and marks the others `deduped`
 * with no `dependencies` key (in this repo 539 of 1164 nodes are deduped, and
 * only 223 carry children). The expanded occurrence is frequently NOT the one
 * at the shortest depth. So "already seen this key, skip it" - the obvious
 * dedupe - silently discards whole subtrees: it is how `elkjs@0.11.1` (EPL-2.0,
 * reached via `@prisma/client > prisma > @prisma/studio-core`) disappeared from
 * an earlier version of this walk. Packages are therefore deduped for the
 * RECORD (one row each, shortest chain kept) but every occurrence is still
 * traversed for CHILDREN. The `visited` set is keyed by position, not identity,
 * so cycles still terminate.
 *
 * @param {Array} roots parsed `pnpm list --json` output (an array of workspace
 *   project nodes)
 * @param {object} options
 * @param {string[]} options.categories which dependency category keys to follow
 * @returns {Map<string, {name, version, path, chain: string[], roots: Set<string>}>}
 */
export function flattenTree(roots, { categories }) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new TypeError(
      'flattenTree requires an explicit non-empty categories array; ' +
        'defaulting it is how devDependencies get silently dropped',
    )
  }

  const found = new Map()
  if (!Array.isArray(roots)) return found

  // Breadth-first so the first chain recorded for a package is the shortest
  // one. Queue entries carry the chain that led to the node.
  const queue = []
  // Guards against revisiting the same node object by the same path. Keyed on
  // the node object itself rather than on packageKey, so that two occurrences
  // of one package (one deduped, one expanded) are both walked.
  const walked = new Set()

  for (const root of roots) {
    if (!root || typeof root !== 'object') continue
    const rootLabel = packageKey(root.name, root.version)
    queue.push({ node: root, chain: [rootLabel], rootLabel })
  }

  while (queue.length > 0) {
    const { node, chain, rootLabel } = queue.shift()

    // A node object reached twice by different parents has identical children
    // both times; walking it again only costs time. A cycle hits this too.
    if (walked.has(node)) continue
    walked.add(node)

    for (const category of categories) {
      const bucket = node[category]
      if (!bucket || typeof bucket !== 'object') continue

      for (const [name, entry] of Object.entries(bucket)) {
        if (!entry || typeof entry !== 'object') continue

        const key = packageKey(name, entry.version)
        const existing = found.get(key)
        const childChain = [...chain, key]

        if (existing) {
          // One row per package: keep the first (shortest) chain, and note the
          // extra workspace root this path came from.
          existing.roots.add(rootLabel)
        } else {
          found.set(key, {
            name,
            version: entry.version ?? null,
            path: entry.path ?? null,
            chain: childChain,
            roots: new Set([rootLabel]),
          })
        }

        // Descend regardless of whether the package was already recorded: this
        // occurrence may be the expanded one that carries the children.
        queue.push({ node: entry, chain: childChain, rootLabel })
      }
    }
  }

  return found
}

/**
 * Keys present in `subject` but not in `baseline`.
 *
 * Used to answer "is this license dev-only?" - the difference between a
 * compliance problem and a build-time detail.
 */
export function keysOnlyIn(subject, baseline) {
  // Sorted, so repeated runs over the same tree produce byte-identical output
  // and a reviewer can diff two reports meaningfully.
  return [...subject.keys()].filter(key => !baseline.has(key)).sort()
}

/**
 * Parse a `pnpm list --json` payload into an array of workspace project nodes.
 *
 * pnpm emits an array; a malformed or empty payload yields an empty array
 * rather than throwing, so a caller that passed the wrong file gets an empty
 * closure it can detect, not a stack trace. The caller is responsible for
 * treating "no roots" as an error - here it is just absence of data.
 */
export function parseListJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
