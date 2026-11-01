/**
 * Row construction and summarisation for the license inventory.
 *
 * Split out of build-license-inventory.mjs when that script crossed the
 * repo's 300-line limit. The CLI and the serializer stayed behind; everything
 * that turns a dependency closure into rows, counts and flagged findings is
 * here, which is also the half that is worth testing without a filesystem.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  classifyExpression,
  readDeclaredLicense,
  ABSENT,
  STRONG,
  WEAK,
  UNKNOWN,
} from './license-classify.mjs'
import {
  flattenTree,
  keysOnlyIn,
  parseListJson,
  DEPENDENCY_CATEGORIES,
  PRODUCTION_CATEGORIES,
} from './license-inventory-tree.mjs'

export function readPackageLicense(pkgPath, readFile = readFileSync) {
  if (!pkgPath) return { declared: null, source: ABSENT, unreadable: true }
  const manifest = join(pkgPath, 'package.json')
  try {
    const parsed = JSON.parse(readFile(manifest, 'utf8'))
    const { expression, source } = readDeclaredLicense(parsed)
    return { declared: expression, source, unreadable: false }
  } catch {
    return { declared: null, source: ABSENT, unreadable: true }
  }
}

/**
 * Build the inventory rows for one root (one workspace package).
 *
 * `devOnly` marks packages present in the full tree but absent from the
 * production closure. That line is the whole point of the report: a copyleft
 * build tool is not the same finding as a copyleft runtime dependency.
 */
export function buildRows(closure, { devOnlyKeys = new Set(), reader } = {}) {
  const rows = []
  for (const [key, node] of closure) {
    const { declared, source, unreadable } = readPackageLicense(node.path, reader)
    const { effective, copyleftNamed, avoidable, conjunctive } =
      classifyExpression(declared)
    rows.push({
      key,
      name: node.name,
      version: node.version,
      path: node.path ?? null,
      // The literal string the package declares, kept verbatim so a reader can
      // diff it against the package.json themselves.
      declared: declared ?? null,
      // Which field it came from: `license`, the deprecated `licenses` array,
      // or nothing at all.
      declaredSource: source,
      unreadable,
      devOnly: devOnlyKeys.has(key),
      category: effective,
      copyleftNamed,
      avoidable,
      // "MIT and ISC": both licenses bind at once, so the row is worth a human
      // read even when every half is permissive.
      conjunctive,
      chain: node.chain ?? [],
    })
  }
  rows.sort((a, b) => a.key.localeCompare(b.key))
  return rows
}

/**
 * Count licenses, descending by count then name, so output is stable.
 *
 * Packages with no license field are counted under an explicit "(no license
 * field)" label rather than an empty string, so the row cannot be misread as
 * a formatting artifact.
 */
export function distribution(rows) {
  const counts = new Map()
  for (const row of rows) {
    const label = row.declared ?? NO_LICENSE_FIELD
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([license, count]) => ({ license, count }))
}

/**
 * The findings that must not be buried in a table: copyleft obligations, and
 * packages whose license could not be determined at all.
 *
 * Strong and weak copyleft are kept apart because they are different facts. An
 * AGPL runtime dependency in a distributed product is a compliance problem; an
 * EPL one carries a notice-and-source obligation for that component only.
 */
export function flagged(rows) {
  return {
    strongCopyleft: rows.filter(r => r.category === STRONG),
    weakCopyleft: rows.filter(r => r.category === WEAK),
    unknown: rows.filter(r => r.category === ABSENT || r.category === UNKNOWN),
    // A copyleft license named but escaped via an OR branch: shown so a reader
    // can see what was considered, not counted as an obligation.
    avoidableCopyleft: rows.filter(r => r.avoidable),
    // Several licenses binding at once ("MIT and ISC"). Not an obligation
    // problem here, but it is not a plain single-license row either.
    conjunctive: rows.filter(r => r.conjunctive),
    unreadable: rows.filter(r => r.unreadable),
  }
}

/**
 * Assemble one root's section: rows, distribution and flagged findings.
 *
 * The production closure follows only PRODUCTION_CATEGORIES. The comparison
 * closure follows every category, so the difference between them is exactly
 * "reachable only through devDependencies" - which is what `devOnly` means.
 */
export function buildRoot(root, allRoots, reader) {
  const prodClosure = flattenTree([root], {
    categories: PRODUCTION_CATEGORIES,
  })
  const match = allRoots.find(
    candidate => candidate.name === root.name && candidate.version === root.version,
  )
  const allClosure = match
    ? flattenTree([match], { categories: DEPENDENCY_CATEGORIES })
    : new Map()
  const devOnlyKeys = new Set(keysOnlyIn(allClosure, prodClosure))

  const prodRows = buildRows(prodClosure, { reader })
  const devRows = buildRows(
    new Map([...allClosure].filter(([key]) => devOnlyKeys.has(key))),
    { devOnlyKeys, reader },
  )

  return {
    name: root.name,
    version: root.version,
    prod: {
      total: prodRows.length,
      rows: prodRows,
      distribution: distribution(prodRows),
      flagged: flagged(prodRows),
    },
    dev: {
      total: devRows.length,
      rows: devRows,
      distribution: distribution(devRows),
      flagged: flagged(devRows),
    },
  }
}

export function buildInventory(prodJson, allJson, reader) {
  const prodRoots = parseListJson(prodJson)
  const allRoots = parseListJson(allJson)
  return prodRoots
    .map(root => buildRoot(root, allRoots, reader))
    .filter(root => root.prod.total > 0 || root.dev.total > 0)
}

/**
 * Label used in the distribution table for a package that declares no license
 * at all. Spelled out rather than left blank: an empty cell reads like a
 * formatting slip, and this is a finding.
 */
export const NO_LICENSE_FIELD = '(no license field)'
