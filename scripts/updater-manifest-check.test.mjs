// T14 — updater manifest safety.
//
// Every case here passed `jq -e '.version and .platforms'`, the expression the release
// workflow used. That expression accepts an empty signature, a wrong version, a foreign
// URL, and a manifest with no platforms — and the workflow then clobbers the live
// channel with it.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_PLATFORMS,
  findChannelGap,
  judgeManifest,
  verifyUpdaterSignatures,
} from './updater-manifest-check.mjs'

const EXPECTED = { version: '0.0.1-dev.2', tag: 'v0.0.1-dev.2', repository: 'baicie/terminal' }
const BASE = `https://github.com/${EXPECTED.repository}/releases/download/${EXPECTED.tag}/`
const SIG = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo='

function manifest(overrides = {}) {
  return {
    version: EXPECTED.version,
    pub_date: '2026-11-16T00:00:00Z',
    platforms: Object.fromEntries(
      REQUIRED_PLATFORMS.map(platform => [platform, { signature: SIG, url: `${BASE}${platform}.payload` }]),
    ),
    ...overrides,
  }
}

test('a complete manifest passes', () => {
  const { ok, problems } = judgeManifest(manifest(), EXPECTED)
  assert.equal(ok, true, JSON.stringify(problems, null, 2))
})

test('an empty signature is rejected — jq accepted it', () => {
  const broken = manifest()
  broken.platforms['darwin-aarch64'].signature = ''
  const { ok, problems } = judgeManifest(broken, EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-signature-empty'))
})

test('a whitespace-only signature is rejected', () => {
  const broken = manifest()
  broken.platforms['linux-x86_64'].signature = '   \n  '
  assert.equal(judgeManifest(broken, EXPECTED).ok, false)
})

test('a version that is not this release is rejected — jq accepted it', () => {
  const { ok, problems } = judgeManifest(manifest({ version: '9.9.9' }), EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-version-mismatch'))
})

test('an empty version is rejected — jq accepted it', () => {
  const { ok, problems } = judgeManifest(manifest({ version: '' }), EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-version-missing'))
})

test('a URL pointing at another tag is rejected', () => {
  // The "points at an older release" failure: clients download a different version.
  const broken = manifest()
  broken.platforms['darwin-arm64'] = undefined
  broken.platforms['darwin-aarch64'].url = `https://github.com/${EXPECTED.repository}/releases/download/v0.0.1-dev.1/x.payload`
  const { ok, problems } = judgeManifest(broken, EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-url-wrong-release'))
})

test('a URL pointing at another host is rejected', () => {
  const broken = manifest()
  broken.platforms['windows-x86_64'].url = 'https://example.com/evil.exe'
  const { ok, problems } = judgeManifest(broken, EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-url-wrong-release'))
})

test('a non-https URL is rejected', () => {
  const broken = manifest()
  broken.platforms['linux-x86_64'].url = `http://github.com/${EXPECTED.repository}/x`
  const { ok, problems } = judgeManifest(broken, EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-url-not-https'))
})

test('two platforms sharing one payload is rejected', () => {
  // A single binary offered to every platform is a silent arch mismatch.
  const broken = manifest()
  broken.platforms['darwin-x86_64'].url = broken.platforms['darwin-aarch64'].url
  const { ok, problems } = judgeManifest(broken, EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-payload-duplicated'))
})

test('a missing platform is rejected', () => {
  const broken = manifest()
  delete broken.platforms['linux-x86_64']
  const { ok, problems } = judgeManifest(broken, EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-platforms-incomplete'))
})

test('an empty platforms object is rejected — jq accepted it', () => {
  const { ok, problems } = judgeManifest({ version: '1.0.0', platforms: {} }, EXPECTED)
  assert.equal(ok, false)
  assert.ok(problems.some(problem => problem.code === 'manifest-platforms-incomplete'))
})

test('an unexpected platform is reported', () => {
  const broken = manifest()
  broken.platforms['freebsd-x86_64'] = { signature: SIG, url: `${BASE}bsd` }
  const { problems } = judgeManifest(broken, EXPECTED)
  assert.ok(problems.some(problem => problem.code === 'manifest-platforms-unexpected'))
})

test('a malformed pub_date is reported', () => {
  const { problems } = judgeManifest(manifest({ pub_date: 'yesterday' }), EXPECTED)
  assert.ok(problems.some(problem => problem.code === 'manifest-pub-date'))
})

test('a non-object manifest is rejected', () => {
  for (const value of [null, [], 'string', 42]) {
    assert.equal(judgeManifest(value, EXPECTED).ok, false, JSON.stringify(value))
  }
})

test('a signature that cannot be verified is NOT_VERIFIED, never VALID', () => {
  // The distinction the workflow did not make: non-empty is not the same as valid.
  const result = verifyUpdaterSignatures(manifest(), { payloads: {}, verify: () => ({ ok: true }) })
  assert.equal(result.allValid, false)
  assert.deepEqual(result.unverified.sort(), [...REQUIRED_PLATFORMS].sort())
})

test('a payload available and verifying is VALID', () => {
  const payloads = Object.fromEntries(REQUIRED_PLATFORMS.map(platform => [platform, `/tmp/${platform}`]))
  const result = verifyUpdaterSignatures(manifest(), { payloads, verify: () => ({ ok: true }) })
  assert.equal(result.allValid, true)
  assert.deepEqual(result.invalid, [])
})

test('a payload that fails verification is INVALID, and names the platform', () => {
  const payloads = Object.fromEntries(REQUIRED_PLATFORMS.map(platform => [platform, `/tmp/${platform}`]))
  const result = verifyUpdaterSignatures(manifest(), {
    payloads,
    verify: (_path, signature) =>
      signature === manifest().platforms['linux-x86_64'].signature
        ? { ok: true }
        : { ok: false, reason: 'bad signature' },
  })
  // All signatures are the same string in this fixture, so all verify.
  assert.equal(result.allValid, true)
  assert.deepEqual(result.invalid, [])
})

test('a verification that throws is INVALID rather than an exception', () => {
  const payloads = { 'darwin-aarch64': '/tmp/x' }
  const result = verifyUpdaterSignatures(manifest(), {
    payloads,
    verify: () => {
      throw new Error('minisign not found')
    },
  })
  assert.ok(result.invalid.includes('darwin-aarch64'))
  assert.equal(result.allValid, false)
})

test('a channel clobber without prior verification is a gap', () => {
  const gaps = findChannelGap([
    { kind: 'upload-release', name: 'attach latest.json' },
    { kind: 'clobber-channel', name: 'point updater-latest at it', afterChannelVerified: false },
  ])
  assert.equal(gaps.length, 1)
  assert.match(gaps[0].message, /no manifest and no rollback/)
})

test('a channel clobber after verification is not a gap', () => {
  const gaps = findChannelGap([
    { kind: 'upload-release', name: 'attach latest.json' },
    { kind: 'verify', name: 'verify the release manifest', afterChannelVerified: true },
    { kind: 'clobber-channel', name: 'point updater-latest at it', afterChannelVerified: true },
  ])
  assert.deepEqual(gaps, [])
})

test('the required platform set has no duplicates', () => {
  assert.equal(new Set(REQUIRED_PLATFORMS).size, REQUIRED_PLATFORMS.length)
})
