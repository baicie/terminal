// The AI dock must not be able to run anything.
//
// ## Why a source-level assertion, and not only a rendered one
//
// `ai-dock-view.test.tsx` asserts the footer says "Nothing is run automatically". That
// checks the *claim*, not the *property*: a future change could add a send path and
// leave the sentence in place, and the suite would stay green.
//
// The property is structural: none of the AI modules reach a function that writes to a
// terminal or a session. That is checkable without a live session, which matters
// because the real-model path is BLOCKED_EXTERNAL — the safety rule has to be verified
// in the environment that exists.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const AI_DIR = path.join(import.meta.dirname)
const LAYOUT_DIR = path.resolve(import.meta.dirname, '../../layout')

/**
 * Calls that would put bytes into a session.
 *
 * ## The list was incomplete, and the omission was the important one
 *
 * It named `session_write`, `terminal.write(` and the two service writes. The path a
 * command palette actually uses to run something — `terminalEmitter.writeCommand`,
 * which the snippet and command-history entries both go through
 * (`components/command-palette/use-palette-selection.ts:62,67`) — was not on it.
 *
 * Measured consequence: if an AI module imported `terminalEmitter` and called
 * `writeCommand`, this test would have stayed green. The property it claims to guard
 * ("the AI dock cannot run anything") would have been false while the guard reported
 * it true, which is the exact shape this repository keeps finding.
 *
 * `terminalEmitter.write` and the bus underneath it are now listed. They are also
 * checked through the import name rather than only the call text, because `write(`
 * is too common to grep for and an aliased import would slip past a call-shaped
 * pattern.
 */
const EXECUTION_CALLS = [
  'session_write',
  'terminal.write(',
  'sshService.write(',
  'sessionService.write(',
  'sftp_upload',
  // The real path: `writeCommand` appends CR and emits on `terminalWriteBus`, which
  // `use-terminal.ts:202` forwards into the PTY of the active tab.
  'writeCommand(',
  'terminalEmitter',
]

/** Imports that would give an AI module a way to run something. */
const EXECUTION_MODULES = [
  'service/terminal-emitter',
  'service/terminal-write-bus',
  'service/ssh',
  'service/sftp-transfer',
]

/**
 * Strip comments before matching.
 *
 * Every module in this repository explains itself at length, and several of them
 * name `terminalEmitter` in prose precisely to say they do not use it. A guard that
 * counted those would fail on documentation, which teaches the next person to delete
 * the explanation rather than fix the code.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function sources(dir: string, prefix: string): Array<{ file: string, text: string }> {
  return readdirSync(dir)
    .filter(name => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name))
    .map(name => ({
      file: `${prefix}${name}`,
      text: readFileSync(path.join(dir, name), 'utf8'),
    }))
}

describe('the AI feature cannot execute anything', () => {
  it('no AI module calls a session-writing function', () => {
    const offenders: string[] = []
    for (const { file, text } of sources(AI_DIR, 'features/ai/')) {
      const body = code(text)
      for (const call of EXECUTION_CALLS) {
        if (body.includes(call)) offenders.push(`${file}: ${call}`)
      }
      for (const module of EXECUTION_MODULES) {
        // An import is enough: the call could be behind any name.
        // Built from a string so the quote characters stay readable; a template with
        // escaped quotes inside a character class trips `no-useless-escape`, and a
        // regex where every other character is a backslash is not one to proofread.
        const importPattern = new RegExp(`from\\s+['"][^'"]*${module}['"]`)
        if (importPattern.test(body)) {
          offenders.push(`${file}: imports ${module}`)
        }
      }
    }
    expect(
      offenders,
      'the AI feature must only show or save its output, never send it',
    ).toEqual([])
  })

  it('no AI dock component calls a session-writing function', () => {
    const offenders: string[] = []
    for (const { file, text } of sources(LAYOUT_DIR, 'layout/')) {
      if (!file.startsWith('layout/ai-dock')) continue
      const body = code(text)
      for (const call of EXECUTION_CALLS) {
        if (body.includes(call)) offenders.push(`${file}: ${call}`)
      }
      for (const module of EXECUTION_MODULES) {
        // Built from a string so the quote characters stay readable; a template with
        // escaped quotes inside a character class trips `no-useless-escape`, and a
        // regex where every other character is a backslash is not one to proofread.
        const importPattern = new RegExp(`from\\s+['"][^'"]*${module}['"]`)
        if (importPattern.test(body)) {
          offenders.push(`${file}: imports ${module}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the result view offers copy and save, and no run action', () => {
    const result = readFileSync(path.join(LAYOUT_DIR, 'ai-dock-result.tsx'), 'utf8')
    expect(result).toMatch(/onSaveSnippet/)
    expect(result).toMatch(/onCopied/)
    // A "run" affordance is what the design forbids; the absence is the assertion.
    expect(result).not.toMatch(/onRun|runCommand|executeCommand/i)
  })
})
