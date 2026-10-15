import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { casesForShell } from './run-terminal-shell-probe-matrix.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')

async function dialectCasesFromFrontend() {
  const source = await readFile(
    path.join(
      projectRoot,
      // The case table lives in the leaf module, not dialect.ts, so that the
      // dialect layer, the result parser and protocol.ts can all depend on it
      // without an import cycle. Reading the copy in dialect.ts instead would
      // pass this contract while the table the parser enforces went stale.
      'packages/frontend/src/experiments/terminal-shell-probe/dialect-cases.ts',
    ),
    'utf8',
  )
  const result = {}
  for (const dialect of ['posix', 'powershell', 'cmd']) {
    const match = new RegExp(dialect + ':\\s*\\[([^\\]]*)\\]').exec(source)
    assert.ok(match, 'dialect ' + dialect + ' must declare its case list')
    result[dialect] = match[1]
      .split(',')
      .map(entry => entry.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
  }
  return result
}

test('the Node runner and the frontend dialect agree on the Windows cases', async () => {
  const frontend = await dialectCasesFromFrontend()
  for (const shell of ['powershell', 'cmd']) {
    assert.deepEqual(
      casesForShell(shell, frontend[shell]),
      frontend[shell],
      shell + ' must accept exactly the cases the frontend dialect declares',
    )
  }
})

test('a Windows shell rejects a case its dialect does not declare', () => {
  assert.throws(
    () => casesForShell('cmd', ['cat-eof', 'vim-edit']),
    /does not support case\(s\) vim-edit/,
  )
  assert.throws(
    () => casesForShell('powershell', ['nano-edit']),
    /does not support case\(s\) nano-edit/,
  )
})

test('a POSIX shell keeps every requested case', () => {
  assert.deepEqual(casesForShell('bash', ['vim-edit', 'pty-resize']), [
    'vim-edit',
    'pty-resize',
  ])
  assert.deepEqual(casesForShell(undefined, ['cat-eof']), ['cat-eof'])
})

