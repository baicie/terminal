/**
 * When may a failure be filed as a known issue?
 *
 * ## The defect this replaces
 *
 * The previous signature was:
 *
 *   /known issue|docs\/issue\.md#|AGENTS\.md:\d+|see issue #\d+/i
 *
 * The first alternative is a bare phrase, so **any** log containing the words "known
 * issue" became `KNOWN_ISSUE` — non-blocking by definition. `known issue: renderer
 * problem` classified as tracked work. That is exactly how a new regression gets
 * absorbed into the baseline and stops being visible.
 *
 * ## The contract
 *
 * A failure is a known issue only when it names where it is tracked, and the
 * reference resolves:
 *
 * | Reference | Form | Validation |
 * | --- | --- | --- |
 * | GitHub issue / PR | `#123`, `owner/repo#123`, a github.com issue URL | number must be in the issue docs when that set is available |
 * | Issue tracker anchor | `docs/issue.md#issue-12` | anchor must exist when the anchor set is available |
 * | Agent guide line | `AGENTS.md:412` | line must be within the file |
 *
 * A phrase with no reference stays `UNKNOWN`. A reference that does not resolve also
 * stays `UNKNOWN` — an unverifiable pointer is not a licence to stop looking.
 */

/**
 * Phrases that *suggest* a known issue.
 *
 * They never classify on their own. They only make a nearby reference more credible
 * to a reader, and the tests assert that each of them alone yields no match.
 */
export const KNOWN_ISSUE_PHRASES = [
  /known issue/i,
  /already known/i,
  /known problem/i,
  /previously observed/i,
  /known failure/i,
  /tracked in/i,
]

const GITHUB_URL = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/i
const QUALIFIED_REF = /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/
const ISSUE_REF = /\bissue\s+#(\d+)\b/i
const BARE_HASH_REF = /(?:^|[\s(])#(\d{1,7})\b/
const DOCS_ANCHOR = /docs\/issue\.md#([A-Za-z0-9_-]+)/i
const AGENTS_LINE = /AGENTS\.md:(\d+)\b/

/**
 * Find the first reference in a text, most explicit form first.
 *
 * Order matters: a full URL also contains a bare `#123`, and the URL form is the one
 * that carries enough information to validate without a local document.
 */
export function parseKnownIssueReference(text) {
  const haystack = String(text ?? '')

  const url = GITHUB_URL.exec(haystack)
  if (url) {
    return {
      kind: 'github-issue',
      raw: url[0],
      number: Number(url[3]),
      repo: `${url[1]}/${url[2]}`,
      explicit: true,
    }
  }

  const qualified = QUALIFIED_REF.exec(haystack)
  if (qualified) {
    return {
      kind: 'github-issue',
      raw: qualified[0],
      number: Number(qualified[3]),
      repo: `${qualified[1]}/${qualified[2]}`,
      explicit: true,
    }
  }

  const anchor = DOCS_ANCHOR.exec(haystack)
  if (anchor) {
    return { kind: 'docs-anchor', raw: anchor[0], anchor: anchor[1], explicit: true }
  }

  const agentsLine = AGENTS_LINE.exec(haystack)
  if (agentsLine) {
    return { kind: 'agents-line', raw: agentsLine[0], line: Number(agentsLine[1]), explicit: true }
  }

  const issueRef = ISSUE_REF.exec(haystack)
  if (issueRef) {
    return { kind: 'github-issue', raw: issueRef[0], number: Number(issueRef[1]), explicit: false }
  }

  const bare = BARE_HASH_REF.exec(haystack)
  if (bare) {
    return { kind: 'github-issue', raw: bare[0].trim(), number: Number(bare[1]), explicit: false }
  }

  return null
}

/**
 * Does the reference resolve?
 *
 * `available` carries what the caller could read. Every entry is optional; omitting
 * one means that kind of proof is unavailable rather than false. When a set is
 * present, a number outside it is rejected.
 *
 * The important case is the compiler's "see issue #105572": a syntactically valid
 * reference to a Rust repository issue. With `knownIssueNumbers` loaded it does not
 * resolve here, so it cannot demote a real build failure to a tracked one.
 */
export function validateKnownIssueReference(reference, available = {}) {
  if (reference === null || reference === undefined) {
    return { valid: false, reason: 'no issue reference found' }
  }

  const { knownIssueNumbers = null, knownAnchors = null, agentsLineCount = null } = available

  if (reference.kind === 'docs-anchor') {
    if (knownAnchors === null) {
      return { valid: false, reason: 'docs/issue.md anchors were not available to verify the reference' }
    }
    return knownAnchors.has(reference.anchor)
      ? { valid: true, reason: `docs/issue.md#${reference.anchor} exists` }
      : { valid: false, reason: `docs/issue.md has no anchor ${JSON.stringify(reference.anchor)}` }
  }

  if (reference.kind === 'agents-line') {
    if (agentsLineCount === null) {
      return { valid: false, reason: 'AGENTS.md was not available to verify the line reference' }
    }
    if (reference.line < 1 || reference.line > agentsLineCount) {
      return {
        valid: false,
        reason: `AGENTS.md:${reference.line} is outside the file (${agentsLineCount} lines)`,
      }
    }
    return { valid: true, reason: `AGENTS.md:${reference.line} exists` }
  }

  // A github-issue reference.
  //
  // Zero is allowed: `docs/issue.md` numbers its own entries from #0, so requiring a
  // positive integer rejected a reference that genuinely exists. The set membership
  // check below is what decides, not an assumption about GitHub's numbering.
  if (!Number.isInteger(reference.number) || reference.number < 0) {
    return { valid: false, reason: `issue number ${JSON.stringify(reference.number)} is not a non-negative integer` }
  }
  if (reference.repo !== undefined && reference.repo !== available.repo) {
    // A pointer into somebody else's tracker is explicit and verifiable by the reader,
    // so it counts — but say which repository so the report is not misleading.
    return { valid: true, reason: `references ${reference.repo}#${reference.number}` }
  }
  if (knownIssueNumbers === null) {
    return {
      valid: false,
      reason: 'the issue tracker was not available to verify the reference',
    }
  }
  return knownIssueNumbers.has(reference.number)
    ? { valid: true, reason: `issue #${reference.number} is documented in docs/issue.md` }
    : { valid: false, reason: `issue #${reference.number} is not documented in docs/issue.md` }
}

/**
 * The full check: reference present **and** resolvable.
 *
 * Returns `{ known: boolean, reason, reference }`. Anything short of a resolved
 * reference is `known: false`, which the caller must treat as `UNKNOWN`.
 */
export function isKnownIssue(text, available = {}) {
  const reference = parseKnownIssueReference(text)
  if (reference === null) {
    return {
      known: false,
      reason: 'no issue, anchor or line reference accompanies the claim',
      reference: null,
    }
  }
  const verdict = validateKnownIssueReference(reference, available)
  return { known: verdict.valid, reason: verdict.reason, reference }
}

/** Extract the `Issue #N` numbers documented in docs/issue.md. */
export function issueNumbersFromDoc(markdown) {
  const numbers = new Set()
  for (const match of String(markdown ?? '').matchAll(/^#{1,6}\s*Issue\s+#(\d+)/gim)) {
    numbers.add(Number(match[1]))
  }
  return numbers
}

/** Extract the heading anchors docs/issue.md can be linked to. */
export function anchorsFromDoc(markdown) {
  const anchors = new Set()
  for (const line of String(markdown ?? '').split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line)
    if (!match) continue
    const slug = match[1]
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
    if (slug) anchors.add(slug)
  }
  return anchors
}
