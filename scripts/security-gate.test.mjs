import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  compare,
  EXIT_FINDINGS,
  EXIT_PASS,
  EXIT_SCAN_FAILED,
  main,
  parseArgs,
  readAuditSnapshot,
  readAuditWarnings,
  readBaseline,
  renderReport,
  toFinding,
  verdictFor,
} from './security-gate.mjs'

/**
 * Writes a snapshot that the test then deletes, for the cases that only need a
 * path to read from once. `withTempDir` needs a callback; this is the shorthand
 * for a single read, so the fixture does not have to be threaded through.
 */
let scratchDir = null
function writeJsonInto(value) {
  scratchDir ??= mkdtempSync(join(tmpdir(), 'security-gate-'))
  const path = join(scratchDir, `snapshot-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(path, JSON.stringify(value))
  return path
}
process.on('exit', () => {
  if (scratchDir !== null) rmSync(scratchDir, { recursive: true, force: true })
})

// A snapshot in the shape `cargo audit --json` actually writes, trimmed to the
// fields the gate reads. Keeping it literal (rather than importing the real
// 8-entry file) means these tests pin the *contract* and do not move every time
// an advisory lands.
function snapshot(entries, warnings = {}) {
  return {
    vulnerabilities: {
      found: entries.length > 0,
      count: entries.length,
      list: entries,
    },
    warnings,
  }
}

function entry(id, crate, version, extra = {}) {
  return {
    advisory: {
      id,
      title: `title for ${id}`,
      cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
      ...extra,
    },
    package: { name: crate, version },
  }
}

function baseline(entries) {
  return { accepted: entries }
}

function accepted(id, crate, version) {
  return { id, crate, version, reason: 'recorded for the test' }
}

/** Runs `fn` in a scratch directory and always removes it. */
function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'security-gate-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeJson(dir, name, value) {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value))
  return path
}

test('a missing audit snapshot is a failed scan, not a clean one', () => {
  // The distinction this pins: "the job never produced a report" and "the report
  // had no advisories" used to look identical, and only one of them is good news.
  withTempDir((dir) => {
    assert.throws(
      () => readAuditSnapshot(join(dir, 'absent.json')),
      /snapshot not found/,
    )
  })
})

test('an empty audit snapshot is a failed scan', () => {
  // cargo audit leaves an empty file behind when it dies before reporting.
  withTempDir((dir) => {
    const path = join(dir, 'empty.json')
    writeFileSync(path, '   \n')
    assert.throws(() => readAuditSnapshot(path), /snapshot is empty/)
  })
})

test('unparseable output is a failed scan, not zero findings', () => {
  withTempDir((dir) => {
    const path = join(dir, 'partial.json')
    writeFileSync(path, '{"vulnerabilities": {"list": [')
    assert.throws(() => readAuditSnapshot(path), /not JSON/)
  })
})

test('valid JSON that is not an audit report is rejected', () => {
  // A successful-looking download of an error page, or a cargo-deny output, must
  // not be read as "no vulnerabilities".
  withTempDir((dir) => {
    const path = writeJson(dir, 'deny.json', { advisories: { errors: [] } })
    assert.throws(() => readAuditSnapshot(path), /no vulnerabilities\.list/)
  })
})

test('an audit entry is flattened to the fields the gate compares', () => {
  const [finding] = [entry('RUSTSEC-2026-0001', 'left-pad', '1.2.3')].map(toFinding)
  assert.deepEqual(finding, {
    id: 'RUSTSEC-2026-0001',
    kind: 'vulnerability',
    crate: 'left-pad',
    version: '1.2.3',
    title: 'title for RUSTSEC-2026-0001',
    severity: 'High',
    score: 7.5,
  })
})

test('an advisory with no CVSS vector stays unscored instead of guessing', () => {
  const finding = toFinding(entry('RUSTSEC-2026-0002', 'crate', '0.1.0', { cvss: '' }))
  assert.equal(finding.severity, null)
  assert.equal(finding.score, null)
})

test('a baseline entry without a version is a configuration error', () => {
  // Without the version the gate cannot tell a recorded exposure from a new
  // release of it, which is the whole point of the ratchet.
  withTempDir((dir) => {
    const path = writeJson(dir, 'baseline.json', baseline([{ id: 'A', crate: 'c' }]))
    assert.throws(() => readBaseline(path), /no string version/)
  })
})

test('a baseline that is absent or has no accepted array is not "no exemptions"', () => {
  // Treating a half-written baseline as empty would fail every build; treating
  // it as "allow everything" would make the gate decorative. Both are refused.
  withTempDir((dir) => {
    assert.throws(() => readBaseline(join(dir, 'absent.json')), /baseline not found/)
    const path = writeJson(dir, 'baseline.json', { accepted: 'nope' })
    assert.throws(() => readBaseline(path), /no accepted\[\] array/)
  })
})

test('one advisory may be accepted for two versions of the same crate', () => {
  // rsa is the live case: 0.9.10 is lock-file residue, 0.10.0-rc.18 is in the
  // build graph and unfixable. Those are different decisions and both stand.
  withTempDir((dir) => {
    const path = writeJson(
      dir,
      'baseline.json',
      baseline([
        accepted('RUSTSEC-2023-0071', 'rsa', '0.9.10'),
        accepted('RUSTSEC-2023-0071', 'rsa', '0.10.0-rc.18'),
      ]),
    )
    assert.equal(readBaseline(path).get('vulnerability|RUSTSEC-2023-0071|rsa').length, 2)
  })
})

test('the same advisory and version twice is refused', () => {
  // A duplicate is almost always a bad merge and hides which reason applies.
  withTempDir((dir) => {
    const path = writeJson(
      dir,
      'baseline.json',
      baseline([
        accepted('RUSTSEC-2023-0071', 'rsa', '0.9.10'),
        accepted('RUSTSEC-2023-0071', 'rsa', '0.9.10'),
      ]),
    )
    assert.throws(() => readBaseline(path), /twice/)
  })
})

test('keying by id and crate means a second crate cannot ride in on an approval', () => {
  withTempDir((dir) => {
    const path = writeJson(
      dir,
      'baseline.json',
      baseline([accepted('RUSTSEC-2023-0071', 'rsa', '0.9.10')]),
    )
    const result = compare(
      [toFinding(entry('RUSTSEC-2023-0071', 'other-crate', '0.9.10'))],
      readBaseline(path),
    )
    assert.equal(result.fresh.length, 1)
    assert.equal(result.changed.length, 0)
  })
})

test('a listed advisory on a new version is a finding, not a silent pass', () => {
  withTempDir((dir) => {
    const path = writeJson(
      dir,
      'baseline.json',
      baseline([accepted('RUSTSEC-2023-0071', 'rsa', '0.9.10')]),
    )
    const result = compare(
      [toFinding(entry('RUSTSEC-2023-0071', 'rsa', '0.10.0-rc.18'))],
      readBaseline(path),
    )
    assert.deepEqual(result.fresh, [])
    assert.equal(result.changed.length, 1)
    assert.deepEqual(result.changed[0].acceptedVersions, ['0.9.10'])
    assert.equal(verdictFor(result), EXIT_FINDINGS)
  })
})

test('a recorded advisory that disappears is reported but does not fail', () => {
  // Failing here would punish the person who just fixed something.
  withTempDir((dir) => {
    const path = writeJson(
      dir,
      'baseline.json',
      baseline([
        accepted('RUSTSEC-2023-0071', 'rsa', '0.9.10'),
        accepted('RUSTSEC-2023-0071', 'rsa', '0.10.0-rc.18'),
      ]),
    )
    const result = compare(
      [toFinding(entry('RUSTSEC-2023-0071', 'rsa', '0.10.0-rc.18'))],
      readBaseline(path),
    )
    assert.deepEqual(result.resolved.map(row => row.version), ['0.9.10'])
    assert.equal(verdictFor(result), EXIT_PASS)
  })
})

test('an empty scan against a non-empty baseline is a pass with stale entries', () => {
  // This is the shape a fully-fixed build produces before the baseline is
  // trimmed. It must be green, so the fix lands without ceremony.
  withTempDir((dir) => {
    const path = writeJson(
      dir,
      'baseline.json',
      baseline([accepted('RUSTSEC-2023-0071', 'rsa', '0.9.10')]),
    )
    const result = compare([], readBaseline(path))
    assert.equal(verdictFor(result), EXIT_PASS)
    assert.equal(result.resolved.length, 1)
  })
})

test('the three exit codes are distinct and match the documented contract', () => {
  assert.deepEqual([EXIT_PASS, EXIT_FINDINGS, EXIT_SCAN_FAILED], [0, 1, 2])
  assert.equal(verdictFor({ fresh: [], changed: [] }), EXIT_PASS)
  assert.equal(verdictFor({ fresh: [{}], changed: [] }), EXIT_FINDINGS)
  assert.equal(verdictFor({ fresh: [], changed: [{}] }), EXIT_FINDINGS)
})

test('the report names what to do instead of only what failed', () => {
  // A gate that says "1 finding" teaches people to widen the baseline. The text
  // has to point at the two legitimate moves.
  const text = renderReport({
    count: 1,
    fresh: [{
      id: 'RUSTSEC-2026-0001',
      crate: 'crate',
      version: '1.0.0',
      title: 'a new hole',
      severity: 'High',
      score: 7.5,
    }],
    changed: [],
    resolved: [],
    baselinePath: '/tmp/baseline.json',
  })
  assert.match(text, /NEW advisories \(1\)/)
  assert.match(text, /Do not widen the baseline/)
})

test('--audit and --baseline are parsed, including the = form', () => {
  assert.deepEqual(parseArgs(['--audit', 'a.json']), {
    audit: 'a.json',
    baseline: parseArgs([]).baseline,
  })
  assert.equal(parseArgs(['--audit=a.json']).audit, 'a.json')
  assert.equal(parseArgs(['-a', 'a.json']).baseline, parseArgs([]).baseline)
  assert.equal(parseArgs(['--baseline', 'b.json']).baseline, 'b.json')
  assert.equal(parseArgs(['--baseline=b.json']).baseline, 'b.json')
})

test('running without --audit is a failed scan, never an implicit pass', () => {
  // The gate must not fall back to a committed snapshot: an old scan is not a scan.
  assert.equal(main([]), EXIT_SCAN_FAILED)
})

test('main returns the scan-failure code when the snapshot cannot be read', () => {
  withTempDir((dir) => {
    assert.equal(main(['--audit', join(dir, 'absent.json')]), EXIT_SCAN_FAILED)
  })
})

test('main is green only when the scan matches the baseline', () => {
  withTempDir((dir) => {
    const audit = writeJson(dir, 'audit.json', snapshot([entry('A', 'crate', '1.0.0')]))
    const base = writeJson(dir, 'baseline.json', baseline([accepted('A', 'crate', '1.0.0')]))
    assert.equal(main(['--audit', audit, '--baseline', base]), EXIT_PASS)

    const wider = writeJson(
      dir,
      'wider.json',
      snapshot([entry('A', 'crate', '1.0.0'), entry('B', 'crate', '2.0.0')]),
    )
    assert.equal(main(['--audit', wider, '--baseline', base]), EXIT_FINDINGS)
  })
})

// --- warning classes -------------------------------------------------------
//
// cargo audit reports vulnerabilities separately from `warnings.unmaintained`,
// `.unsound` and `.yanked`. The Phase 9.1 job read only the first list, so a
// crate could be withdrawn or unsound and the job still reported nothing to see.

test('unmaintained, unsound and yanked crates are all findings, not footnotes', () => {
  withTempDir((dir) => {
    const path = writeJson(dir, 'audit.json', snapshot([], {
      unmaintained: [entry('RUSTSEC-2024-0370', 'proc-macro-error', '1.0.4')],
      unsound: [entry('RUSTSEC-2024-0429', 'glib', '0.18.5')],
      yanked: [{ package: { name: 'aes', version: '0.9.0' }, kind: 'yanked' }],
    }))
    const findings = readAuditWarnings(path).map(toFinding)
    assert.deepEqual(
      findings.map(f => [f.kind, f.crate]),
      [['unmaintained', 'proc-macro-error'], ['unsound', 'glib'], ['yanked', 'aes']],
    )
  })
})

test('a yanked release gets a stable id instead of an empty one', () => {
  // A yanked entry carries no advisory object. Without a synthesized id every
  // withdrawal would key as an empty string and collide with the next one.
  const [finding] = readAuditWarnings(
    writeJsonInto(snapshot([], {
      yanked: [{ package: { name: 'aes', version: '0.9.0' }, kind: 'yanked' }],
    })),
  ).map(toFinding)
  assert.equal(finding.id, 'YANKED-aes')
  assert.equal(finding.title, 'yanked release')
})

test('a class cargo audit omits entirely means none of that class', () => {
  // A clean run drops `yanked` from the JSON rather than writing an empty array.
  // Reading a missing key as an error would fail every run where nothing was
  // withdrawn, which is most of them.
  const warnings = readAuditWarnings(
    writeJsonInto({ vulnerabilities: { list: [] }, warnings: { unsound: [], unmaintained: [] } }),
  )
  assert.deepEqual(warnings, [])
})

test('a non-array warning class is still an error', () => {
  // Tolerating a missing key must not tolerate a malformed one.
  assert.throws(
    () => readAuditWarnings(writeJsonInto({ vulnerabilities: { list: [] }, warnings: { unsound: 'none' } })),
    /non-array warnings\.unsound/,
  )
})

test('a snapshot with no warnings object at all is refused', () => {
  // "No warnings section" is not evidence of "no unsound crates". It means the
  // file is not the shape this gate understands.
  assert.throws(
    () => readAuditWarnings(writeJsonInto({ vulnerabilities: { list: [] } })),
    /no warnings object/,
  )
})

test('an unmaintained crate cannot reuse a vulnerability entry for the same id', () => {
  // The key includes the class. A crate whose advisory id appears in both lists
  // (different exposure, same package) must not have one approve the other.
  withTempDir((dir) => {
    const path = writeJson(
      dir,
      'baseline.json',
      baseline([{ ...accepted('RUSTSEC-2024-0370', 'proc-macro-error', '1.0.4'), kind: 'vulnerability' }]),
    )
    const result = compare(
      [toFinding({ ...entry('RUSTSEC-2024-0370', 'proc-macro-error', '1.0.4'), kind: 'unmaintained' })],
      readBaseline(path),
    )
    assert.equal(result.fresh.length, 1)
  })
})

test('main rates warning classes too, so a yanked release fails the build', () => {
  withTempDir((dir) => {
    const audit = writeJson(dir, 'audit.json', snapshot([], {
      yanked: [{ package: { name: 'aes', version: '0.9.0' }, kind: 'yanked' }],
    }))
    const base = writeJson(dir, 'baseline.json', baseline([]))
    assert.equal(main(['--audit', audit, '--baseline', base]), EXIT_FINDINGS)
  })
})
