// A GUI spec must identify tabs by `data-tab-type`, never by their label.
//
// ## The failure this pins
//
// Run 44686124865, Windows job, evidence `e2e-03.json`:
//
//     tabs {"described":[
//       {"label":"Administrator: C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe","type":"local"},
//       {"label":"Administrator: C:\\Windows\\system32\\conhost.exe","type":"remote"}]}
//
// The second entry **is** the `E2E Local` connection — `type: "remote"` is set by
// `connectToHost` and nothing else creates it — but its label had been overwritten by
// the remote shell's OSC 0/2 title with the console host's path. The spec matched
// `aria-label` for `E2E Local`, found nothing, and failed with
// "could not activate the first host tab again" — on a run where the connection, the
// dock binding and the per-host directory marker were all correct
// (`rows: ["e2e-second.marker…"]`).
//
// So the constraint is not style. A label is a string the *remote machine* controls:
// it is a path, a program name or a status line, and it changes while the user works.
// `data-tab-type` comes from `Tab.type` in the app's own store.
//
// ## Why a source-level test and not a browser one
//
// The GUI suites need a built app, a WebDriver session and an sshd; running one to
// check which attribute a spec selected would make this assertion cost 30 minutes. The
// rule is about the spec's *source*, so it is checked against the source — the same
// approach `terminal-route-literal-guard.test.mjs` uses for a different invariant.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '..')
const SPECS = path.join(ROOT, 'e2e/gui/specs')

/** Every spec file, so a new one is covered without editing this list. */
function specFiles() {
  return readdirSync(SPECS)
    .filter(name => name.endsWith('.e2e.mjs'))
    .map(name => ({ name, source: readFileSync(path.join(SPECS, name), 'utf8') }))
}

test('no spec selects a tab by its label', () => {
  /*
   * The pattern is `aria-label` being *read* from a tab element. Taking `role="tab"`
   * and then reading `aria-label` is what went wrong; reading it to put it in a
   * diagnostic report is fine, which is why the assertion looks for a comparison
   * rather than for the attribute.
   */
  const offenders = []
  for (const { name, source } of specFiles()) {
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      // A tab lookup that filters or matches on aria-label containing/including text.
      if (!/aria-label/.test(line)) return
      // Diagnostics record the label; that is not a selection.
      const isSelection =
        /\.includes\(|\.startsWith\(|\.endsWith\(|===|==|\.match\(|\.test\(/.test(line) &&
        // `tab.getAttribute('aria-label') === 'true'`-style checks are about
        // selection state, not identity — those read `aria-selected`.
        !/aria-selected/.test(line)
      if (isSelection) offenders.push(`${name}:${index + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    'a tab must be identified by data-tab-type; its aria-label is set by the remote ' +
      'shell and changes while the user works. Offending lines:\n' +
      offenders.join('\n'),
  )
})

test('the tab strip still exposes data-tab-type, so the rule is satisfiable', () => {
  /*
   * The guard above would be worthless if the attribute disappeared: every spec would
   * have to fall back to the label. This asserts the product keeps the hook the specs
   * depend on.
   */
  const tabs = readFileSync(path.join(ROOT, 'packages/frontend/src/layout/tabs.tsx'), 'utf8')
  assert.match(tabs, /data-tab-type=\{tab\.type\}/, 'the tab strip must render data-tab-type')
  assert.match(
    tabs,
    /const displayLabel = getTabDisplayLabel\(tab\)/,
    'the label is the shell-controlled value this rule exists because of; if it stops ' +
      'being used the rule can be revisited, but not silently',
  )
})

test('the two-host case counts remote tabs rather than naming them', () => {
  const source = readFileSync(path.join(SPECS, 'e2e-03-sftp-dock.e2e.mjs'), 'utf8')
  // The specific detection that replaced the label match.
  assert.match(
    source,
    /remote\.length > baselineRemote/,
    'connectHostByName must detect the new connection by the remote count rising',
  )
  assert.match(
    source,
    /remoteCount !== 2/,
    'the two-host case must assert two remote tabs exist',
  )
})

/*
 * ## A case title that contradicts its assertions is a small lie with a long life
 *
 * `e2e-03`'s two-host case was titled
 *
 *     the file listing follows the active host, not the last connection
 *
 * and asserted the opposite. INV-13 (`store/sftp-binding.ts`, UX-1c) made the binding
 * **pinned** precisely so that switching tabs does *not* repoint the panel — the case
 * checks that the pin holds, that the "follow" affordance appears, and that following
 * is what moves it.
 *
 * The title survived because the behaviour it described is the thing UX-1c removed.
 * Anyone reading CI output would conclude the product still follows focus, which is the
 * exact bug the case exists to prevent from returning.
 *
 * This guard is narrow on purpose: it checks the words that have a known-correct
 * meaning in this codebase, not general prose quality.
 */
test('no case title claims the dock follows focus', () => {
  const offenders = []
  for (const { name, source } of specFiles()) {
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      const match = /it\(\s*'([^']+)'/.exec(line)
      if (!match) return
      const title = match[1]
      // "follows the active host" / "follows focus" describe the behaviour INV-13
      // removed. A case may still test the *affordance* — that is "when asked".
      if (/follows (the )?(active|current) (host|tab|focus)/i.test(title)) {
        offenders.push(`${name}:${index + 1}: ${title}`)
      }
    })
  }
  assert.deepEqual(
    offenders,
    [],
    'the dock is pinned (INV-13); a title saying it follows focus describes the defect ' +
      'that rule removed. Reword to "stays pinned … follows only when asked":\n' +
      offenders.join('\n'),
  )
})
