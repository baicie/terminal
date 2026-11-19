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

/** Calls that would put bytes into a session. */
const EXECUTION_CALLS = [
  'session_write',
  'terminal.write(',
  'sshService.write(',
  'sessionService.write(',
  'sftp_upload',
]

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
      for (const call of EXECUTION_CALLS) {
        if (text.includes(call)) offenders.push(`${file}: ${call}`)
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
      for (const call of EXECUTION_CALLS) {
        if (text.includes(call)) offenders.push(`${file}: ${call}`)
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
