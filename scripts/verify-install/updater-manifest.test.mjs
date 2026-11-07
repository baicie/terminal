import assert from 'node:assert/strict'
import test from 'node:test'
import { compareVersions, validateManifest } from './updater-manifest.mjs'

function manifest(overrides = {}) {
  return {
    version: '0.0.1-dev.3',
    platforms: {
      'darwin-aarch64': { url: 'https://example.test/a.dmg.tar.gz', signature: 'A'.repeat(64) },
      'darwin-x86_64': { url: 'https://example.test/b.dmg.tar.gz', signature: 'B'.repeat(64) },
      'windows-x86_64': { url: 'https://example.test/c.nsis.zip', signature: 'C'.repeat(64) },
      'linux-x86_64-appimage': { url: 'https://example.test/d.AppImage.tar.gz', signature: 'D'.repeat(64) },
    },
    ...overrides,
  }
}

test('accepts a complete newer manifest', () => {
  assert.equal(validateManifest(manifest(), { currentVersion: '0.0.1-dev.2' }).version, '0.0.1-dev.3')
})

test('rejects missing signatures, missing platforms and non-monotonic versions', () => {
  assert.throws(
    () => validateManifest(manifest({
      platforms: { ...manifest().platforms, 'darwin-aarch64': { url: 'https://example.test/a' } },
    })),
    /signature/,
  )
  const withoutArm = manifest()
  delete withoutArm.platforms['darwin-aarch64']
  assert.throws(() => validateManifest(withoutArm), /missing required platform/)
  assert.throws(
    () => validateManifest(manifest({ version: '0.0.1-dev.2' }), { currentVersion: '0.0.1-dev.2' }),
    /not newer/,
  )
})

test('rejects a bundle-type/payload mismatch', () => {
  assert.throws(
    () => validateManifest(manifest({
      platforms: {
        ...manifest().platforms,
        'linux-x86_64-deb': { url: 'https://example.test/e.AppImage.tar.gz', signature: 'E'.repeat(64) },
      },
    })),
    /does not point at a \.deb/,
  )
})

test('compares stable and prerelease versions deterministically', () => {
  assert.equal(compareVersions('0.0.1-dev.3', '0.0.1-dev.2'), 1)
  assert.equal(compareVersions('0.0.1', '0.0.1-dev.9'), 1)
  assert.equal(compareVersions('bad', '0.0.1'), null)
})
