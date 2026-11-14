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
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// fixtures/ lives at e2e/gui/fixtures, so the repository root is three up.
const ROOT = path.resolve(import.meta.dirname, '../../..')
const ARTIFACTS = path.join(ROOT, 'e2e/gui/artifacts')

export function binaryPath() {
  return process.env.GUI_E2E_BINARY ?? path.join(ROOT, 'src-tauri/target/release/terminal')
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

export function sourceInfo() {
  return {
    sha: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0,
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
 * `verdict` is one of PASS / FAIL / PARTIAL / NOT_RUN and is written verbatim —
 * this module never upgrades an outcome.
 */
export async function writeEvidence(caseId, { verdict = 'PASS', terminal, window, notes, error } = {}) {
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
    verdict,
    recordedAt: new Date().toISOString(),
    platform: platformInfo(),
    source: sourceInfo(),
    binary: binaryInfo(),
    window: window ?? null,
    terminal: terminal ?? null,
    screenshot,
    notes: notes ? redact(notes) : undefined,
    error: error ? redact(error) : undefined,
  }
  const file = path.join(dir, `${caseId}.json`)
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  return file
}
