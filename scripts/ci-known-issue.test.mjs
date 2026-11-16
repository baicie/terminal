// T04 — a "known issue" is a reference, not a phrase.
//
// The defect: `/known issue|…/` matched the bare phrase, so `known issue: renderer
// problem` classified as tracked-and-non-blocking. That is how a new regression is
// absorbed into the baseline.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  anchorsFromDoc,
  isKnownIssue,
  issueNumbersFromDoc,
  parseKnownIssueReference,
  validateKnownIssueReference,
} from './ci-known-issue.mjs'

const SOURCES = {
  repo: 'baicie/terminal',
  knownIssueNumbers: new Set([0, 1, 2, 47, 85]),
  // The slugs GitHub generates for `### Issue #0`, `### Issue #47` headings.
  knownAnchors: new Set(['issue-0', 'issue-47', '一关键问题-critical']),
  agentsLineCount: 1637,
}

test('every phrase alone stays unverified', () => {
  // The exact strings the task names as counter-examples.
  for (const phrase of [
    'known issue',
    'known issue: renderer problem',
    'this is a known issue',
    'already known',
    'known problem',
    'previously observed',
    'known failure',
    'tracked in',
  ]) {
    const verdict = isKnownIssue(phrase, SOURCES)
    assert.equal(verdict.known, false, JSON.stringify(phrase))
  }
})

test('a phrase plus a resolving reference is accepted', () => {
  const verdict = isKnownIssue('known issue: docs/issue.md#issue-0', SOURCES)
  assert.equal(verdict.known, true, verdict.reason)
})

test('an issue number must be documented', () => {
  assert.equal(isKnownIssue('Issue #47', SOURCES).known, true)
  assert.equal(isKnownIssue('Issue #99999', SOURCES).known, false)
  // A syntactically perfect reference into a foreign tracker would otherwise let a
  // compiler's "see issue #105572" demote a real build failure.
  assert.equal(isKnownIssue('error[E0433]; see issue #105572', SOURCES).known, false)
})

test('a qualified reference into another repository is explicit enough to count', () => {
  // It names where it is tracked, which is the contract. The report says which repo.
  const verdict = isKnownIssue('blocked by rust-lang/rust#105572', SOURCES)
  assert.equal(verdict.known, true)
  assert.match(verdict.reason, /rust-lang\/rust/)
})

test('an AGENTS.md line must be inside the file', () => {
  assert.equal(isKnownIssue('see AGENTS.md:412', SOURCES).known, true)
  assert.equal(isKnownIssue('see AGENTS.md:1', SOURCES).known, true)
  assert.equal(isKnownIssue('see AGENTS.md:1637', SOURCES).known, true)
  assert.equal(isKnownIssue('see AGENTS.md:1638', SOURCES).known, false)
  assert.equal(isKnownIssue('see AGENTS.md:99999', SOURCES).known, false)
  assert.equal(isKnownIssue('see AGENTS.md:0', SOURCES).known, false)
})

test('an unverifiable reference stays unknown instead of being trusted', () => {
  // This is the direction that matters: when the documentation could not be read,
  // every claim becomes UNKNOWN rather than presumed tracked.
  const blind = { repo: 'baicie/terminal', knownIssueNumbers: null, knownAnchors: null, agentsLineCount: null }
  assert.equal(isKnownIssue('Issue #47', blind).known, false)
  assert.equal(isKnownIssue('docs/issue.md#issue-0', blind).known, false)
  assert.equal(isKnownIssue('AGENTS.md:412', blind).known, false)
})

test('the reference parser prefers the most explicit form', () => {
  const url = parseKnownIssueReference('see https://github.com/baicie/terminal/issues/85 and #1')
  assert.equal(url.kind, 'github-issue')
  assert.equal(url.number, 85)
  assert.equal(url.repo, 'baicie/terminal')

  const qualified = parseKnownIssueReference('other/repo#12')
  assert.equal(qualified.repo, 'other/repo')
  assert.equal(qualified.number, 12)

  const anchor = parseKnownIssueReference('docs/issue.md#issue-0')
  assert.equal(anchor.kind, 'docs-anchor')

  const line = parseKnownIssueReference('AGENTS.md:412')
  assert.equal(line.kind, 'agents-line')
  assert.equal(line.line, 412)

  assert.equal(parseKnownIssueReference('nothing here'), null)
})

test('a malformed reference is rejected with a reason, not silently accepted', () => {
  for (const reference of [
    { kind: 'github-issue', number: -1 },
    { kind: 'github-issue', number: 1.5 },
    { kind: 'github-issue', number: Number.NaN },
  ]) {
    const verdict = validateKnownIssueReference(reference, SOURCES)
    assert.equal(verdict.valid, false, JSON.stringify(reference))
    assert.ok(verdict.reason.length > 0)
  }
})

test('the issue doc parser finds numbered entries and heading anchors', () => {
  const markdown = ['## 一、关键问题', '### Issue #0: 本地终端连接慢', '### Issue #12: x'].join('\n')
  const numbers = issueNumbersFromDoc(markdown)
  assert.deepEqual([...numbers].sort((a, b) => a - b), [0, 12])
  const anchors = anchorsFromDoc(markdown)
  assert.ok([...anchors].some(anchor => anchor.startsWith('issue-0')))
})

test('a real docs/issue.md is parseable and contains the entries the repo cites', async () => {
  // End-to-end against the actual document, so a format change is caught here rather
  // than by every reference silently becoming unverified.
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const doc = readFileSync(path.resolve(import.meta.dirname, '..', 'docs/issue.md'), 'utf8')
  const numbers = issueNumbersFromDoc(doc)
  assert.ok(numbers.size > 10, `expected many documented issues, got ${numbers.size}`)
  assert.ok(numbers.has(0), 'docs/issue.md numbers from #0')

  // And the citation form the docs actually produce resolves against the real file.
  const real = {
    repo: 'baicie/terminal',
    knownIssueNumbers: numbers,
    knownAnchors: anchorsFromDoc(doc),
    agentsLineCount: 1638,
  }
  assert.equal(isKnownIssue('known issue: docs/issue.md#issue-0', real).known, true)
  assert.equal(isKnownIssue('see Issue #0', real).known, true)
  // A number past the real set stays unknown.
  assert.equal(isKnownIssue('Issue #999999', real).known, false)
})
