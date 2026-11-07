#!/usr/bin/env node
/**
 * Static updater-manifest contract used by the Phase 9.5.2 updater foundation.
 *
 * This does NOT download, verify a minisign signature, install or restart.
 * It rejects manifests that cannot be installed by the bundle type they name,
 * are not monotonic, or pair a platform with the wrong payload/signature.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const REQUIRED = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'linux-x86_64-appimage',
]

function fail(message) {
  throw new Error(message)
}

export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value))
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

export function validateManifest(manifest, { currentVersion, requiredPlatforms = REQUIRED } = {}) {
  if (!manifest || typeof manifest !== 'object') fail('manifest is not an object')
  if (!parseVersion(manifest.version)) fail('manifest version is not semver: ' + manifest.version)
  if (!manifest.platforms || typeof manifest.platforms !== 'object') {
    fail('manifest has no platforms object')
  }
  if (currentVersion) {
    const comparison = compareVersions(manifest.version, currentVersion)
    if (comparison === null) fail('current version is not semver')
    if (comparison <= 0) fail('manifest version ' + manifest.version + ' is not newer than ' + currentVersion)
  }
  const urls = new Set()
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    if (!entry || typeof entry !== 'object') fail('platform ' + platform + ' is not an object')
    if (typeof entry.url !== 'string' || !/^https?:\/\//.test(entry.url)) {
      fail('platform ' + platform + ' has no http(s) url')
    }
    if (typeof entry.signature !== 'string' || entry.signature.trim().length < 32) {
      fail('platform ' + platform + ' has no usable signature')
    }
    if (urls.has(entry.url)) fail('duplicate payload url: ' + entry.url)
    urls.add(entry.url)
    if (platform.includes('deb') && !/\.deb(?:$|\?)/.test(entry.url)) {
      fail('deb platform ' + platform + ' does not point at a .deb')
    }
    if (platform.includes('appimage') && !/\.AppImage(?:$|\?|\.tar\.gz)/.test(entry.url)) {
      fail('AppImage platform ' + platform + ' does not point at an .AppImage')
    }
  }
  for (const platform of requiredPlatforms) {
    if (!manifest.platforms[platform]) fail('manifest is missing required platform ' + platform)
  }
  return { version: manifest.version, platforms: Object.keys(manifest.platforms).sort() }
}

function main(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      flags[argv[index].slice(2)] = argv[index + 1]
      index += 1
    }
  }
  if (!flags.manifest) {
    console.error('usage: updater-manifest.mjs --manifest <latest.json> [--current <version>]')
    process.exit(2)
  }
  const manifest = JSON.parse(readFileSync(flags.manifest, 'utf8'))
  const result = validateManifest(manifest, { currentVersion: flags.current })
  console.log(JSON.stringify(result, null, 2))
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error('[FAIL] ' + (error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}
