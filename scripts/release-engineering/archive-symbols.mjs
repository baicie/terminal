#!/usr/bin/env node
/**
 * Symbol archival for a release matrix arm.
 *
 * Stripping is only shippable if the debug information survives somewhere. This
 * repository has no archive step at all, which is why `build-optimization.md`
 * flags `strip = "symbols"` as conditional rather than free.
 *
 * What each platform needs:
 *
 *   macOS    a `.dSYM` bundle next to the binary (`dsymutil`). Without it a
 *            stripped arm produces unsymbolicated crash reports forever.
 *   Linux    a separate debug file (`objcopy --only-keep-debug`) referenced from
 *            the binary with a build-id, so `gdb`/`addr2line` can find it.
 *   Windows  a `.pdb` emitted by the linker. This script cannot be exercised on
 *            macOS; it reports NOT_RUN rather than pretending.
 *
 * Every output is recorded with the SHA-256 of both the binary and the symbol
 * artifact plus the source commit, so a crash report can be tied to the exact
 * build that produced it.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = process.env.RE_MATRIX_OUT || '/tmp/re-matrix'

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function have(command) {
  return spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).status === 0
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  }
}

/** macOS: dsymutil produces <binary>.dSYM, archiving DWARF out of the binary. */
function macosSymbols(binary, outDir) {
  if (!have('dsymutil')) {
    return { platform: 'macos', status: 'NOT_RUN', reason: 'dsymutil not available' }
  }
  const dsym = path.join(outDir, `${path.basename(binary)}.dSYM`)
  const result = run('dsymutil', [binary, '-o', dsym])
  if (!result.ok) {
    return {
      platform: 'macos',
      status: 'FAIL',
      reason: `dsymutil exited ${result.status}`,
      stderr: result.stderr.slice(0, 500),
    }
  }
  // `dwarfdump --uuid` is the explicit check that the dSYM matches this binary.
  // A dSYM for a different build silently gives wrong line numbers, which is
  // worse than no symbols at all.
  const uuid = run('dwarfdump', ['--uuid', dsym])
  const binaryUuid = run('dwarfdump', ['--uuid', binary])
  const dsymUuid = uuid.ok ? (uuid.stdout.match(/UUID: ([0-9A-F-]+)/)?.[1] ?? null) : null
  const binUuid = binaryUuid.ok
    ? (binaryUuid.stdout.match(/UUID: ([0-9A-F-]+)/)?.[1] ?? null)
    : null
  return {
    platform: 'macos',
    status: dsymUuid && binUuid && dsymUuid === binUuid ? 'PASS' : 'PARTIAL',
    artifact: path.relative(OUT, dsym),
    dsymUuid,
    binaryUuid,
    uuidMatches: Boolean(dsymUuid && binUuid && dsymUuid === binUuid),
    bytes: existsSync(dsym)
      ? Number(execFileSync('du', ['-sk', dsym], { encoding: 'utf8' }).split('\t')[0]) * 1024
      : 0,
  }
}

/** Linux: keep the debug info in a file the build-id points at. */
function linuxSymbols(binary, outDir) {
  if (!have('objcopy')) {
    return { platform: 'linux', status: 'NOT_RUN', reason: 'objcopy not available' }
  }
  const debug = path.join(outDir, `${path.basename(binary)}.debug`)
  const kept = run('objcopy', ['--only-keep-debug', binary, debug])
  if (!kept.ok) {
    return { platform: 'linux', status: 'FAIL', reason: `objcopy exited ${kept.status}` }
  }
  const buildId = run('readelf', ['-n', binary])
  return {
    platform: 'linux',
    status: kept.ok ? 'PASS' : 'PARTIAL',
    artifact: path.relative(OUT, debug),
    bytes: existsSync(debug) ? statSync(debug).size : 0,
    buildId: buildId.ok ? (buildId.stdout.match(/Build ID: ([0-9a-f]+)/)?.[1] ?? null) : null,
  }
}

function windowsSymbols() {
  // A .pdb is produced by link.exe on a Windows host. There is no way to make
  // one from macOS, and a fabricated "PASS" here would be the exact thing this
  // report is supposed to prevent.
  return {
    platform: 'windows',
    status: 'NOT_RUN',
    reason: 'PDB is produced by the MSVC linker on Windows; not buildable from this host',
  }
}

/** Record the symbol situation for one arm. */
export function archiveSymbols({ profile, binary, label }) {
  const outDir = path.join(OUT, 'symbols', label || profile)
  mkdirSync(outDir, { recursive: true })
  const platform = process.platform
  const symbols =
    platform === 'darwin'
      ? macosSymbols(binary, outDir)
      : platform === 'linux'
        ? linuxSymbols(binary, outDir)
        : windowsSymbols()

  const record = {
    profile,
    label: label || profile,
    platform,
    binary: path.relative(ROOT, binary),
    binaryBytes: statSync(binary).size,
    binarySha256: sha256(binary),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    symbols,
    // The pairing that matters for a crash report: this binary, this symbol
    // artifact, this commit. Anything else is an unverifiable claim.
    pairingComplete:
      symbols.status === 'PASS' &&
      (symbols.platform !== 'macos' || symbols.uuidMatches === true),
    otherPlatforms: [
      platform === 'darwin' ? null : macosSymbols.toString() && { platform: 'macos', status: 'NOT_RUN' },
      platform === 'linux' ? null : { platform: 'linux', status: 'NOT_RUN' },
      platform === 'win32' ? null : windowsSymbols(),
    ].filter(Boolean),
  }
  writeFileSync(path.join(outDir, 'symbols.json'), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const profile = process.argv[2] || 'release'
  const binary = path.join(ROOT, 'src-tauri/target', profile, 'terminal')
  if (!existsSync(binary)) {
    console.error(`no binary at ${binary}; build it first`)
    process.exit(2)
  }
  const record = archiveSymbols({ profile, binary })
  console.log(JSON.stringify(record, null, 2))
}
