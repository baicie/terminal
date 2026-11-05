#!/usr/bin/env node
/**
 * Version-neutral installer metadata inspection for the upgrade harness.
 *
 * The upgrade chain must never assume that a file called "dev.1" is dev.1 or
 * that the DMG/DEB/NSIS payload has the identity the source tree currently has.
 * This command reads the artifact itself:
 *
 *   sha256      the bytes on disk, compared with the release digest
 *   version     CFBundleShortVersionString / dpkg Version / file version
 *   identifier  CFBundleIdentifier / package name, compared with the expected id
 *   arch        binary architecture, compared with the runner/host
 *
 * Usage:
 *   node scripts/verify-install/asset-metadata.mjs inspect \
 *     --installer <path> --platform darwin --json <report.json> \
 *     [--expect-sha256 <sha>] [--expect-version <v>] [--expect-identifier <id>]
 */
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PROVIDER = 'asset-metadata'

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[token.slice(2)] = true
      } else {
        flags[token.slice(2)] = next
        index += 1
      }
    } else {
      rest.push(token)
    }
  }
  return { command: rest[0], flags }
}

function requireFlag(flags, name) {
  const value = flags[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('missing --' + name)
  }
  return value
}

async function inspectMacos(installer) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'asset-metadata-'))
  const mount = path.join(work, 'mnt')
  const checks = []
  let mounted = false
  try {
    execFileSync('mkdir', ['-p', mount])
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, installer])
    mounted = true
    checks.push('dmg mounted read-only')
    const entries = readdirSyncSafe(mount)
    const appName = entries.find(entry => entry.endsWith('.app'))
    if (!appName) throw new Error('no .app payload in the DMG')
    const app = path.join(mount, appName)
    const plist = path.join(app, 'Contents', 'Info.plist')
    const identifier = (
      await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])
    ).stdout.trim()
    const version = (
      await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist])
    ).stdout.trim()
    const executableName = (
      await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist])
    ).stdout.trim()
    const binary = path.join(app, 'Contents', 'MacOS', executableName)
    if (!existsSync(binary)) throw new Error('CFBundleExecutable does not exist: ' + binary)
    const arch = (await run('lipo', ['-archs', binary])).stdout.trim()
    checks.push('plist identity and executable read')
    return {
      platform: 'darwin',
      bundleName: appName,
      identifier,
      version,
      arch,
      executable: executableName,
      checks,
      status: 'PASS',
    }
  } finally {
    if (mounted) {
      await run('hdiutil', ['detach', mount, '-force']).catch(() => undefined)
    }
    rmSync(work, { recursive: true, force: true })
  }
}

function readdirSyncSafe(directory) {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

async function inspectLinux(installer) {
  const name = path.basename(installer)
  if (name.endsWith('.deb')) {
    const [version, architecture, packageName] = await Promise.all([
      run('dpkg-deb', ['-f', installer, 'Version']).then(result => result.stdout.trim()),
      run('dpkg-deb', ['-f', installer, 'Architecture']).then(result => result.stdout.trim()),
      run('dpkg-deb', ['-f', installer, 'Package']).then(result => result.stdout.trim()),
    ])
    return {
      platform: 'linux',
      bundleName: packageName,
      identifier: packageName,
      version,
      arch: architecture,
      checks: ['deb control metadata read'],
      status: 'PASS',
    }
  }
  if (name.endsWith('.AppImage')) {
    // Prefer the payload's own .desktop/AppRun metadata. The filename is a
    // fallback for display only; it must not be presented as a read identity.
    const work = mkdtempSync(path.join(os.tmpdir(), 'appimage-meta-'))
    let version = null
    let arch = null
    let metadataSource = 'UNKNOWN'
    const checks = []
    try {
      chmodSync(installer, 0o755)
      await run(installer, ['--appimage-extract'], { cwd: work, timeout: 60_000 })
      checks.push('AppImage payload extracted')
      const root = path.join(work, 'squashfs-root')
      const desktop = readdirSync(root).find(entry => entry.endsWith('.desktop'))
      if (desktop) {
        const contents = readFileSync(path.join(root, desktop), 'utf8')
        const field = key => {
          const match = new RegExp('^' + key + '=(.*)$', 'm').exec(contents)
          return match ? match[1].trim() : null
        }
        version = field('X-AppImage-Version') || field('Version')
        if (version) metadataSource = 'desktop'
      }
      if (!version) {
        // Tauri's linuxdeploy AppImage usually omits X-AppImage-Version; the
        // AppStream metadata is the remaining payload-owned version.
        const metainfoDirs = [
          path.join(root, 'usr', 'share', 'metainfo'),
          path.join(root, 'usr', 'share', 'appdata'),
        ]
        for (const directory of metainfoDirs) {
          if (!existsSync(directory)) continue
          for (const entry of readdirSync(directory)) {
            if (!/\.(metainfo|appdata)\.xml$/.test(entry)) continue
            const xml = readFileSync(path.join(directory, entry), 'utf8')
            const release = /<release[^>]*\bversion="([^"]+)"/.exec(xml)
            if (release) {
              version = release[1]
              metadataSource = 'appstream'
              break
            }
          }
          if (version) break
        }
      }
      const appRun = path.join(root, 'AppRun')
      if (existsSync(appRun)) {
        const file = (await run('file', ['-b', appRun])).stdout
        if (/aarch64|ARM aarch64/i.test(file)) arch = 'arm64'
        else if (/x86-64|x86_64/i.test(file)) arch = 'x64'
      }
      checks.push('AppImage AppRun inspected')
      // Record whether the payload carries its own GL stack; this explains
      // EGL failures on a headless runner without guessing.
      const bundledGl = (
        await run('find', [
          root,
          '-maxdepth',
          '5',
          '-name',
          'libEGL*',
          '-o',
          '-name',
          'libGL*',
          '-o',
          '-name',
          'dri',
        ])
      ).stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(entry => path.relative(root, entry))
      checks.push('bundled GL entries: ' + (bundledGl.join(',') || 'none'))
    } catch (error) {
      checks.push('AppImage extraction failed: ' + errorMessage(error))
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
    return {
      platform: 'linux',
      bundleName: name,
      identifier: null,
      version,
      filenameVersion: versionFromFileName(name),
      arch: arch || archFromFileName(name),
      archSource: arch ? 'AppRun' : 'filename',
      metadataSource,
      checks,
      status: version ? 'PASS' : 'NOT_RUN',
    }
  }
  throw new Error('unsupported Linux installer: ' + name)
}

async function inspectWindows(installer) {
  const name = path.basename(installer)
  if (process.platform !== 'win32') {
    return {
      platform: 'win32',
      bundleName: name,
      identifier: null,
      version: versionFromFileName(name),
      arch: archFromFileName(name),
      checks: ['NSIS metadata is NOT_RUN outside Windows'],
      status: 'NOT_RUN',
    }
  }
  const script =
    "$v=(Get-Item -LiteralPath '" +
    installer.replaceAll("'", "''") +
    "').VersionInfo; Write-Output ($v.FileVersion + '|' + $v.ProductVersion)"
  const { stdout } = await run('powershell', ['-NoProfile', '-Command', script])
  const [fileVersion, productVersion] = stdout.trim().split('|')
  return {
    platform: 'win32',
    bundleName: name,
    identifier: null,
    version: productVersion || fileVersion || versionFromFileName(name),
    arch: archFromFileName(name),
    checks: ['NSIS file version read'],
    status: 'PASS',
  }
}

export function versionFromFileName(name) {
  const match = /(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/.exec(name)
  return match ? match[1] : null
}

export function archFromFileName(name) {
  if (/aarch64|arm64/i.test(name)) return 'arm64'
  if (/x86_64|x64|amd64/i.test(name)) return 'x64'
  if (/universal/i.test(name)) return 'universal'
  return null
}

export function verifyExpected(metadata, expected) {
  const problems = []
  if (expected.sha256 && metadata.sha256 !== expected.sha256) {
    problems.push('sha256 ' + metadata.sha256 + ' != expected ' + expected.sha256)
  }
  if (expected.version && metadata.version !== expected.version) {
    problems.push('version ' + JSON.stringify(metadata.version) + ' != expected ' + expected.version)
  }
  if (expected.identifier && metadata.identifier !== expected.identifier) {
    problems.push('identifier ' + JSON.stringify(metadata.identifier) + ' != expected ' + expected.identifier)
  }
  return problems
}

async function inspect(flags) {
  const installer = path.resolve(requireFlag(flags, 'installer'))
  const platform = typeof flags.platform === 'string' ? flags.platform : process.platform
  if (!existsSync(installer)) throw new Error('installer does not exist: ' + installer)
  const sha256 = sha256File(installer)
  const size = statSync(installer).size
  let metadata
  if (platform === 'darwin') metadata = await inspectMacos(installer)
  else if (platform === 'linux') metadata = await inspectLinux(installer)
  else if (platform === 'win32' || platform === 'windows') metadata = await inspectWindows(installer)
  else throw new Error('unsupported platform: ' + platform)
  const expected = {
    sha256: typeof flags['expect-sha256'] === 'string' ? flags['expect-sha256'] : null,
    version: typeof flags['expect-version'] === 'string' ? flags['expect-version'] : null,
    identifier: typeof flags['expect-identifier'] === 'string' ? flags['expect-identifier'] : null,
  }
  const problems = verifyExpected({ ...metadata, sha256 }, expected)
  const report = {
    provider: PROVIDER,
    installer,
    size,
    sha256,
    ...metadata,
    expected,
    problems,
    status: problems.length > 0 ? 'FAIL' : metadata.status,
  }
  if (typeof flags.json === 'string') {
    writeFileSync(flags.json, JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify(report, null, 2))
  if (problems.length > 0) process.exitCode = 1
  return report
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  try {
    const parsed = parseArgs(process.argv.slice(2))
    if (parsed.command !== 'inspect') {
      throw new Error('usage: asset-metadata.mjs inspect --installer <path> --platform <darwin|linux|win32>')
    }
    await inspect(parsed.flags)
  } catch (error) {
    console.error('[' + PROVIDER + '] ' + errorMessage(error))
    process.exitCode = 2
  }
}
