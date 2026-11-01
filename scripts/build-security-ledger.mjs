#!/usr/bin/env node
/**
 * Build the RustSec ledger for docs/phase9-1/security-advisories.md.
 *
 * Every field here has to be checkable by someone else: the advisory id, the
 * locked version, the CVSS vector RustSec publishes, and - the part that is
 * usually hand-waved - whether the crate is actually in the build graph.
 * Reachability is derived from cargo tree, not from reading the product and
 * guessing which protocols it uses.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve from this file, not from the caller's working directory: cargo tree
// has to run inside src-tauri while the outputs belong to the repo root, and a
// script that silently writes to src-tauri/docs is worse than one that fails.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CRATE_DIR = join(ROOT, 'src-tauri')
const OUT_DIR = join(ROOT, 'docs/phase9-1')
const AUDIT = '/tmp/audit91.json'

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: CRATE_DIR })
  } catch (error) {
    return error.stdout ?? ''
  }
}

const audit = JSON.parse(readFileSync(AUDIT, 'utf8'))
const advisories = audit.vulnerabilities?.list ?? []

// One cargo tree dump serves every lookup.
const normalTree = sh('cargo', ['tree', '--prefix', 'none', '--edges', 'normal', '--target', 'all'])
const allTree = sh('cargo', ['tree', '--prefix', 'none', '--edges', 'all', '--target', 'all'])

function inTree(tree, name, version) {
  const needle = name + ' v' + version
  return tree.split('\n').some(line => line.startsWith(needle))
}

const rows = advisories.map(entry => {
  const name = entry.package.name
  const version = entry.package.version
  const advisory = entry.advisory ?? {}
  const cvss = advisory.cvss ?? ''
  const severity = (() => {
    const m = /\/([A-Z]:[A-Z]\/[A-Z]:[A-Z]\/[A-Z]:[A-Z]\/[A-Z]:[A-Z]\/[A-Z]:[A-Z]\/[A-Z]:[A-Z]\/[A-Z]:[A-Z])$/.exec(cvss)
    return m ? m[1] : ''
  })()
  const normal = inTree(normalTree, name, version)
  const anyEdge = inTree(allTree, name, version)
  // Three states, each directly checkable by re-running the same command.
  // "absent-from-build-graph" is the only one that can justify an exemption, and
  // it is proven by cargo tree not listing the crate at all - not by reading the
  // product and assuming it never speaks that protocol.
  const reach = normal
    ? 'normal dependency'
    : anyEdge
      ? 'build/dev/target-only'
      : 'absent-from-build-graph'
  return {
    id: advisory.id ?? '',
    title: (advisory.title ?? '').replace(/\|/g, '\\|'),
    crate: name,
    version,
    cvss: cvss || '(not published)',
    severity: severity || '(not published)',
    reach,
  }
})

rows.sort((a, b) => a.crate.localeCompare(b.crate) || a.version.localeCompare(b.version))

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'security-advisories.json'), JSON.stringify({ generatedFrom: 'cargo audit --json', count: rows.length, rows }, null, 2))

const lines = []
lines.push('# RustSec 漏洞台账（Phase 9.1）')
lines.push('')
lines.push('> 由 scripts/build-security-ledger.mjs 从 cargo audit --json 自动生成，未手工编辑。')
lines.push('> 可达性来自 cargo tree，不是「读产品代码猜它用不用某种协议」。')
lines.push('')
lines.push('**共 ' + rows.length + ' 条。**')
lines.push('')
lines.push('| # | advisory | crate | 锁定版本 | CVSS 向量 | 可达性 |')
lines.push('| --- | --- | --- | --- | --- | --- |')
rows.forEach((row, index) => {
  lines.push('| ' + (index + 1) + ' | ' + row.id + ' | ' + row.crate + ' | ' + row.version + ' | ' + (row.severity || row.cvss) + ' | ' + row.reach + ' |')
})
lines.push('')
writeFileSync(join(OUT_DIR, 'security-advisories.md'), lines.join('\n'))

const byReach = rows.reduce((acc, row) => { acc[row.reach] = (acc[row.reach] ?? 0) + 1; return acc }, {})
console.log(JSON.stringify({ count: rows.length, byReach, byCrate: rows.reduce((acc, r) => { acc[r.crate] = (acc[r.crate] ?? 0) + 1; return acc }, {}) }, null, 2))