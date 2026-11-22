/**
 * Evidence capture for native GUI E2E.
 *
 * The task requires every case to record platform, SHA, binary hash, timings,
 * CSS and pixel size, DPR, a screenshot, the xterm cols/rows, session lifecycle
 * events and a verdict. A screenshot alone is not evidence of anything.
 *
 * Two rules are enforced here rather than left to each spec:
 *   • a screenshot is written even when the case failed (pass `verdict: 'FAIL'`
 *     and the error text);
 *   • nothing that could carry a credential reaches disk — see `redact`.
 */
import { execFileSync } from 'node:child_process'
import { appBinaryPath } from '../../../scripts/gui-e2e-platform.mjs'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// fixtures/ lives at e2e/gui/fixtures, so the repository root is three up.
const ROOT = path.resolve(import.meta.dirname, '../../..')
const ARTIFACTS = path.join(ROOT, 'e2e/gui/artifacts')

export function binaryPath() {
  return process.env.GUI_E2E_BINARY ?? appBinaryPath(ROOT)
}

/** Strip anything that looks like a secret before it can be written to disk. */
export function redact(text) {
  return String(text)
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[redacted private key]',
    )
    .replace(/\b(sk|pk|ghp|gho|github_pat)_[A-Za-z0-9_]{16,}\b/g, '[redacted token]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [redacted]')
    .replace(/(password|passphrase|secret|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    /*
     * The developer's own account, in the two shapes it reaches evidence.
     *
     * Measured in e2e-05's notes: the PTY echoes the shell prompt, which carries
     * `user@machine`; and Rust-side paths under `/Users/<name>/…` appear in startup
     * traces. Neither is a credential, but a public repository is not the place to
     * publish who ran the suite on which laptop.
     *
     * Anchored to those shapes on purpose: `@` alone is far too common (mail
     * addresses in prose, `user@host` arguments that are product data) to rewrite
     * globally, and a rule that mangled ordinary text would make the evidence
     * unreadable for the reader it exists for.
     */
    .replace(
      // The host part must NOT look like a domain: a prompt's host is a machine name
      // (`macbook-pro`, `RUNNER~1`), while an address has a dot-suffixed TLD. Requiring
      // "no dot after the first segment" keeps `dev@example.com` intact.
      // The left boundary is "start, whitespace, or a JSON/quote delimiter": notes
      // carry PTY output inside an escaped JSON string, where the prompt is preceded
      // by `\"` rather than a space (measured — the first version of this rule missed
      // it for exactly that reason).
      // The boundary set includes `\\` as well: multi-line PTY output reaches the record
      // with literal `\n` sequences, so the prompt after a newline is preceded by a
      // backslash, not whitespace. Both shapes were measured; the first rule missed the
      // second and left one running prompt in e2e-01's measurements.
      /(^|[\s"':=\\])([A-Za-z0-9._-]+)@([A-Za-z0-9-]+)(?=\s)/g,
      '$1[user]@[host]',
    )
    .replace(/\/Users\/[A-Za-z0-9._-]+\//g, '/Users/[user]/')
    .replace(/\/home\/[A-Za-z0-9._-]+\//g, '/home/[user]/')
    .replace(/C:\\Users\\[A-Za-z0-9._-]+\\/gi, 'C:\\Users\\[user]\\')
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export function platformInfo() {
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    node: process.version,
    // `os.version()` is available on modern Node; fall back when it is not.
    osVersion: typeof os.version === 'function' ? os.version() : 'unknown',
  }
}

/**
 * What the evidence is evidence *of*.
 *
 * ## Why `dirty` excludes the evidence directory
 *
 * It used to be `git(['status', '--porcelain']).length > 0`, over the whole tree. The
 * files under `e2e/gui/artifacts/e2e-0X/` are **tracked** (they are the committed
 * evidence), and every spec run overwrites its own — so the moment a spec wrote its
 * JSON, the tree was dirty and the flag said `true`.
 *
 * Measured on the merged evidence for `main@486ca6e`: **all ten case files reported
 * `dirty: true`**, on three platforms, on a clean CI checkout. A field that is always
 * true describes nothing, and a reader who checks it learns only that the spec wrote
 * its own output.
 *
 * What the field is *for* is "can this binary be rebuilt from the recorded SHA". The
 * evidence files are not part of that build, so they are excluded. Everything else —
 * a modified source file, an untracked script — still counts, because that genuinely
 * makes the recorded SHA insufficient.
 *
 * `--porcelain` paths are NUL-free and one per line, so matching the artifacts prefix
 * on the path portion is enough; the two-character status prefix is skipped.
 */
/**
 * Which porcelain lines represent a change that matters for reproducibility.
 *
 * Exported so the rule is testable against literal input rather than by grepping this
 * file's source. The evidence directory is excluded because those files are tracked,
 * rewritten by every run, and are not part of the build the SHA names.
 */
export function dirtySourceLines(porcelain) {
  if (porcelain === 'unknown') {
    // `git` failed. Evidence that cannot name its source is not evidence of a
    // rebuildable build, so this is reported as dirty rather than clean.
    return ['?? git-unavailable']
  }
  return porcelain
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    // `XY <path>` — two status characters, one space, then the path.
    .filter(line => !line.slice(3).startsWith('e2e/gui/artifacts'))
}

export function sourceInfo() {
  return {
    sha: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: dirtySourceLines(git(['status', '--porcelain'])).length > 0,
  }
}

export function binaryInfo() {
  const file = binaryPath()
  try {
    const bytes = readFileSync(file)
    return {
      path: path.relative(ROOT, file),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    }
  } catch {
    return { path: path.relative(ROOT, file), missing: true }
  }
}

/**
 * Persist one case's evidence.
 *
 * `verdict` is written verbatim — this module never upgrades an outcome. The canonical
 * values are PASS / FAIL / PARTIAL / NOT_RUN; a spec may use a more specific **non-passing**
 * label (e.g. `PENDING_REQUIRES_TN01`) when it records a known historical defect, and the
 * guard below permits that as long as the verdict is not claiming success.
 *
 * When the caller omits `verdict`, it is derived from whether an `error` was supplied, so
 * a spec that forgets to pass one cannot produce a PASS for a failing case.
 *
 * `extra` carries per-case measurements. It is spread into the record rather than
 * nested, and it is `redact`ed like `notes`: a measurement that happens to include a
 * path or a command must not smuggle a secret past the redaction step.
 */
export async function writeEvidence(
  caseId,
  { verdict, terminal, window, command, notes, error, extra } = {},
) {
  // ## The guard is against *claiming success*, not against specific labels
  //
  // The original rule was `error ⇒ verdict must be FAIL`. That rejected
  // `PENDING_REQUIRES_TN01`, which is a legitimate non-passing label for a known
  // historical defect — and it did so *after* the run had already failed, so the
  // evidence write threw and the real failure was replaced by a guard error:
  //
  //   Error: writeEvidence(e2e-02): verdict PENDING_REQUIRES_TN01 contradicts the recorded error
  //
  // The danger this guard exists for is a PASS written over a failure. So: an error may
  // never accompany a passing verdict, and any other explicit non-passing label is
  // allowed. A verdict that claims success is the only one rejected.
  const PASSING = new Set(['PASS', 'OK', 'SUCCESS'])
  const resolved = error ? (verdict ?? 'FAIL') : (verdict ?? 'NOT_RUN')
  if (error && verdict && PASSING.has(String(verdict).toUpperCase())) {
    throw new Error(
      `writeEvidence(${caseId}): verdict ${verdict} contradicts the recorded error`,
    )
  }

  const dir = path.join(ARTIFACTS, caseId)
  mkdirSync(path.join(dir, 'screens'), { recursive: true })

  let screenshot = null
  if (globalThis.browser?.saveScreenshot) {
    try {
      const file = path.join(dir, 'screens', `${caseId}-${Date.now()}.png`)
      await globalThis.browser.saveScreenshot(file)
      screenshot = path.relative(ROOT, file)
    } catch (err) {
      notes = `${notes ?? ''}\nscreenshot failed: ${err.message}`.trim()
    }
  }

  const record = {
    case: caseId,
    verdict: resolved,
    recordedAt: new Date().toISOString(),
    platform: platformInfo(),
    source: sourceInfo(),
    binary: binaryInfo(),
    window: window ?? null,
    /*
     * `terminal` carries the PTY snapshot — the one field where a shell prompt is the
     * *subject* of the measurement rather than incidental output. It went through
     * neither `redact` nor `redactDeep` (measured: e2e-01's `bufferTail` held a real
     * `user@machine` while every other field was clean), so the rule that covers notes
     * and measurements was silently not covering this one.
     */
    terminal: terminal ? redactDeep(terminal) : null,
    // Raw command buffer evidence: when a case fails only in CI, the buffer tail is
    // what makes the difference diagnosable without a re-run. It is also a PTY
    // snapshot — the same `user@machine` exposure as `terminal`, and it was passing
    // through untouched for the same reason.
    command: command ? redactDeep(command) : null,
    screenshot,
    notes: notes ? redact(notes) : undefined,
    error: error ? redact(error) : undefined,
    ...(extra ? { extra: redactDeep(extra) } : {}),
  }
  const file = path.join(dir, `${caseId}.json`)
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  return file
}

/** `redact` every string inside a JSON-shaped measurement tree. */
function redactDeep(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        // Keyed by name, because `redact` only recognises `password: x` in a single
        // string. A measurement written as `{ password: 'hunter2' }` reaches it as
        // two separate strings — the key in one call, the value in another — and
        // neither looks like a secret on its own. Measured: that shape passed
        // through untouched before this check existed.
        SECRET_KEY.test(key) ? '[redacted]' : redactDeep(inner),
      ]),
    )
  }
  return value
}

/**
 * Names that make a value a secret regardless of what the value looks like.
 *
 * Deliberately broad: a measurement is not supposed to contain any of these, so a
 * false positive costs one unreadable number while a false negative writes a
 * credential to a committed artefact.
 */
const SECRET_KEY =
  /^(pass(word|phrase)?|secret|token|api[-_]?key|private[-_]?key|credential|authorization)$/i
