/**
 * Load the documentation that makes a KNOWN_ISSUE reference verifiable.
 *
 * Kept separate from `ci-known-issue.mjs` (which is pure) so the parsing rules stay
 * testable without a filesystem, and so a missing document is a normal condition
 * rather than a crash: when `docs/issue.md` cannot be read, every reference is
 * unverifiable and `isKnownIssue` returns false.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { anchorsFromDoc, issueNumbersFromDoc } from './ci-known-issue.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

function readIfPresent(file) {
  try {
    return readFileSync(path.join(ROOT, file), 'utf8')
  } catch {
    return null
  }
}

/**
 * Everything the validator needs, or `null` for each thing that could not be read.
 *
 * `repo` comes from the environment so a bare `#123` can be checked against the
 * local tracker, while a `other/repo#123` is accepted as an explicit external pointer.
 */
export function loadKnownIssueSources({ root = ROOT } = {}) {
  const issueDoc = readIfPresent('docs/issue.md')
  const agentsDoc = readIfPresent('AGENTS.md')

  return {
    repo: process.env.REPO ?? process.env.GITHUB_REPOSITORY ?? null,
    knownIssueNumbers: issueDoc === null ? null : issueNumbersFromDoc(issueDoc),
    knownAnchors: issueDoc === null ? null : anchorsFromDoc(issueDoc),
    agentsLineCount: agentsDoc === null ? null : agentsDoc.split('\n').length,
  }
}
