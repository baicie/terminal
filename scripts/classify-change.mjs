#!/usr/bin/env node
/**
 * Decide whether a change is documentation-only.
 *
 * ## Why this is a program instead of inline shell
 *
 * The inline version had a fail-open path that no test could see: when
 * `git diff --name-only "$base"...HEAD` failed, it fell back to
 * `git show --name-only HEAD`, which lists **one commit** rather than the whole
 * branch. A branch whose last commit touched only Markdown was then classified
 * docs-only, and eight heavy jobs skipped — while the preceding commits had changed
 * `src-tauri/`.
 *
 * It also could not be tested: every rule only ran inside a GitHub runner.
 *
 * ## The rules, and why each is closed
 *
 * | Input | Verdict | Reason |
 * | --- | --- | --- |
 * | any path outside the doc globs | not docs-only | the expensive path is the safe default |
 * | a rename into `docs/` | **not** docs-only | the source path it came from changed too |
 * | a deletion of `src-tauri/foo.rs` | not docs-only | deleting code is a code change |
 * | an empty file list | not docs-only | unknown is not "documentation" |
 * | a diff that could not be computed | not docs-only | fail closed |
 * | a workflow file | not docs-only | `.github/` is not a doc glob |
 *
 * Usage: `node scripts/classify-change.mjs <repo> <base> <head>`
 * Prints `docs_only=true|false` and exits 0; exits 2 when the diff cannot be computed.
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

/** Paths that are documentation and nothing else. */
export const DOC_PATTERNS = [/\.md$/i, /^docs\//, /^\.workbuddy\//]

/**
 * Normalise a path before matching.
 *
 * Git reports repository-relative paths, so `docs/` is anchored at the root — but a
 * path can still arrive with a `.` or `..` segment when the caller built it, and
 * `docs/../src-tauri/src/lib.rs` matched the `^docs/` anchor before this existed.
 * Collapsing those segments first is what makes the anchor mean "the docs directory".
 */
export function normalisePath(file) {
  const parts = []
  for (const segment of String(file).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      // Escaping the root stays escaped: `../x` is outside the repository and is
      // certainly not documentation.
      if (parts.length === 0) return `../${'x'}`
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

/** Is this one path documentation-only? */
export function isDocPath(file) {
  const normalised = normalisePath(file)
  if (normalised.startsWith('../')) return false
  return DOC_PATTERNS.some(pattern => pattern.test(normalised))
}

/**
 * Classify a list of changed paths.
 *
 * Renames arrive from `git diff --name-status` as `R###\told\tnew`; both sides count,
 * because moving a source file into `docs/` still removed it from the build.
 */
export function classifyPaths(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    // Nothing known: not "documentation". A PR whose diff could not be read must not
    // be able to skip the product gates.
    return { docsOnly: false, reason: 'no changed paths were determined', files: [] }
  }

  const files = []
  let docsOnly = true
  for (const entry of entries) {
    // `name-status` gives `M\ta.txt`; `name-only` gives `a.txt`.
    const parts = String(entry).split('\t')
    const paths = parts.length > 1 ? parts.slice(1) : [parts[0]]
    for (const file of paths) {
      const trimmed = file.trim()
      if (!trimmed) continue
      files.push(trimmed)
      if (!isDocPath(trimmed)) docsOnly = false
    }
  }

  return {
    docsOnly,
    reason: docsOnly
      ? `${files.length} documentation path(s)`
      : 'at least one non-documentation path changed',
    files,
  }
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function main() {
  const args = process.argv.slice(2)
  // `--print-files` writes the changed path list to stdout (one per line) and the
  // verdict to stderr, so the workflow can publish the SAME list the verdict came from.
  // A second `git diff` in the workflow was two diffs that had to agree with nothing
  // comparing them — and its redirection bound to the wrong command.
  const printFiles = args.includes('--print-files')
  const positional = args.filter(arg => !arg.startsWith('--'))
  const [repo, base, head = 'HEAD'] = positional
  if (!repo || !base) {
    console.error('usage: classify-change.mjs <repo> <base> [head] [--print-files]')
    return 2
  }

  // In `--print-files` mode the machine-readable list goes to stdout and the prose to
  // stderr, so a caller can redirect stdout without capturing commentary.
  const say = printFiles ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts)

  let entries
  try {
    // `--no-renames` would hide half of a move; `-M` plus `name-status` reports both
    // sides, which is what `classifyPaths` needs.
    entries = git(['diff', '--name-status', '-M', `${base}...${head}`], repo)
      .split('\n')
      .filter(line => line.trim().length > 0)
  } catch (error) {
    // ## The fail-open path this replaces
    //
    // The old script fell back to `git show --name-only HEAD` here, which describes
    // one commit and not the branch. That is how a branch could be classified
    // docs-only on the strength of its last commit alone.
    console.error(
      `could not compute the diff between ${base} and ${head}: ${error.message}\n` +
        'Refusing to classify: an unreadable diff is not documentation.',
    )
    // In `--print-files` mode stdout is the machine-readable path list, so the verdict
    // goes to stderr here too. Writing `docs_only=false` to stdout put a non-path line
    // into the list the workflow publishes as `changed`.
    if (printFiles) console.error('docs_only=false')
    else console.log('docs_only=false')
    return 2
  }

  const { docsOnly, reason, files } = classifyPaths(entries)
  say(`classified ${files.length} path(s): ${reason}`)
  say(`docs_only=${docsOnly}`)
  if (printFiles) {
    // Deduplicated and sorted: a rename contributes both sides, and a reader wants one
    // line per path. Sorting also makes the output stable across git versions.
    for (const file of [...new Set(files)].sort()) console.log(file)
  }
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
