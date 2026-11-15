// T13 — the change classifier that decides which jobs run.
//
// A fail-open here is worse than a slow CI: it skips the product gates while `CI /
// required` still reports green. Every case below is a way to make heavy jobs skip
// without changing product code.
import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyPaths, isDocPath } from './classify-change.mjs'

test('markdown and docs paths are documentation', () => {
  for (const path of ['README.md', 'docs/ci/ci-audit.md', '.workbuddy/notes.md']) {
    assert.equal(isDocPath(path), true, path)
  }
})

test('anything else is not documentation', () => {
  for (const path of [
    'src-tauri/src/lib.rs',
    'packages/frontend/src/App.tsx',
    '.github/workflows/ci.yml',
    'package.json',
    'scripts/verify.mjs',
    'docs/../src-tauri/src/lib.rs',
  ]) {
    assert.equal(isDocPath(path), false, path)
  }
})

test('an all-docs change is docs-only', () => {
  const { docsOnly } = classifyPaths(['M\tREADME.md', 'A\tdocs/ci/x.md'])
  assert.equal(docsOnly, true)
})

test('one source file makes it a full run', () => {
  const { docsOnly } = classifyPaths(['M\tREADME.md', 'M\tsrc-tauri/src/lib.rs'])
  assert.equal(docsOnly, false)
})

test('an empty change set is not docs-only', () => {
  // "We could not determine the diff" and "the diff is documentation" are different
  // answers, and only one of them is safe to skip the product gates on.
  for (const empty of [[], null, undefined]) {
    const { docsOnly, reason } = classifyPaths(empty)
    assert.equal(docsOnly, false)
    assert.match(reason, /no changed paths/)
  }
})

test('a rename into docs/ counts both sides', () => {
  // The failure this prevents: `R100  src-tauri/src/legacy.rs  docs/legacy.md` —
  // classifying on the destination alone would call a source deletion documentation.
  const { docsOnly, files } = classifyPaths(['R100\tsrc-tauri/src/legacy.rs\tdocs/legacy.md'])
  assert.equal(docsOnly, false)
  assert.deepEqual(files.sort(), ['docs/legacy.md', 'src-tauri/src/legacy.rs'])
})

test('a rename between two docs paths stays docs-only', () => {
  const { docsOnly } = classifyPaths(['R100\tdocs/old.md\tdocs/new.md'])
  assert.equal(docsOnly, true)
})

test('deleting a source file is not documentation', () => {
  const { docsOnly } = classifyPaths(['D\tsrc-tauri/src/removed.rs'])
  assert.equal(docsOnly, false)
})

test('a workflow change is not documentation', () => {
  // `.github/` is not in the doc globs, and this is the case that matters most: a PR
  // that weakens the workflow must run the full suite.
  assert.equal(classifyPaths(['M\t.github/workflows/ci.yml']).docsOnly, false)
})

test('mixed input keeps the strict answer regardless of order', () => {
  const forward = classifyPaths(['M\ta.md', 'M\tsrc-tauri/x.rs', 'M\tb.md'])
  const backward = classifyPaths(['M\tsrc-tauri/x.rs', 'M\ta.md', 'M\tb.md'])
  assert.equal(forward.docsOnly, false)
  assert.equal(backward.docsOnly, false)
})

test('a path that merely contains docs is not documentation', () => {
  // `docs/` is anchored at the repository root; `src/docs/generator.rs` is code.
  assert.equal(isDocPath('src/docs/generator.rs'), false)
  assert.equal(isDocPath('packages/frontend/src/view/docs.tsx'), false)
})

test('blank lines and whitespace do not create phantom entries', () => {
  const { docsOnly, files } = classifyPaths(['M\tREADME.md', '', '   '])
  assert.equal(docsOnly, true)
  assert.deepEqual(files, ['README.md'])
})
