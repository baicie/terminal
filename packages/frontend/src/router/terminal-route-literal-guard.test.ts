// UX-1b — INV-5 stays closed.
//
// The semantic source only helps if call sites use it. This test reads the source
// tree and fails on a reintroduced literal comparison, which is how the eleven
// scattered checks accumulated in the first place: each one looked harmless.
//
// It deliberately allows the literals that are *destinations* rather than
// *decisions*: a nav item whose path is `/terminal`, a `navigate('/terminal')`
// target, a route table entry. Those name a place. The comparison forms
// (`=== '/terminal'`, `!== '/terminal'`, `.includes('/terminal')`,
// `.startsWith('/terminal')`) are the decision, and only `isTerminalPath` may make
// it.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.resolve(process.cwd(), 'src')

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(target)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    if (entry.name.includes('.test.')) return []
    return [target]
  })
}

/** Forms that decide visibility, and must go through `isTerminalPath`. */
const DECISION_PATTERNS = [
  /===\s*['"]\/terminal['"]/,
  /!==\s*['"]\/terminal['"]/,
  /['"]\/terminal['"]\s*===/,
  /['"]\/terminal['"]\s*!==/,
  /\.includes\(\s*['"]\/terminal['"]\s*\)/,
  /\.startsWith\(\s*['"]\/terminal['"]\s*\)/,
]

describe('no call site re-derives the terminal-visibility check', () => {
  it('compares against the literal nowhere outside the one module', () => {
    const offenders: string[] = []
    for (const file of collectSourceFiles(sourceRoot)) {
      if (file.endsWith('router/terminal-route.ts')) continue
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      lines.forEach((line, index) => {
        // Comments are documentation, not decisions; a doc line quoting the old
        // form is exactly how this rule stays legible.
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
        for (const pattern of DECISION_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push(
              `${path.relative(sourceRoot, file)}:${index + 1} ${trimmed}`,
            )
          }
        }
      })
    }

    expect(offenders).toEqual([])
  })

  it('the guard itself would catch a reintroduced comparison', () => {
    // A guard nobody has seen fire is a guard nobody knows works. This checks the
    // patterns against a representative line rather than trusting them.
    const sample = "const isTerminalRoute = location.pathname === '/terminal'"
    expect(DECISION_PATTERNS.some(pattern => pattern.test(sample))).toBe(true)
    const allowed = "navigate('/terminal')"
    expect(DECISION_PATTERNS.some(pattern => pattern.test(allowed))).toBe(false)
  })
})
