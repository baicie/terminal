// Model profiles: what can be stored, and where text may be sent.
//
// The endpoint rules are security rules, not formatting rules: the endpoint decides
// where the user's selected terminal text goes.

import { describe, expect, it } from 'vitest'
import {
  PROFILE_LIMITS,
  checkEndpoint,
  modelSecretResource,
  profileProblem,
  profileUsable,
  validateProfile,
  type ModelProfilePublic,
} from './model-profile'

function profile(overrides: Partial<ModelProfilePublic> = {}): ModelProfilePublic {
  return {
    id: 'p-1',
    name: 'Local',
    provider: 'local',
    endpoint: 'https://api.example.test/v1',
    modelId: 'gpt-4o-mini',
    temperature: null,
    maxOutputTokens: 1024,
    timeoutMs: 30_000,
    streaming: false,
    secretRef: null,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('endpoint rules', () => {
  it('allows https anywhere', () => {
    expect(checkEndpoint('https://api.example.test/v1').ok).toBe(true)
  })

  it('allows plain http to loopback, because a local model server is normal', () => {
    for (const endpoint of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:8080',
      'http://127.0.0.5:1234',
      'http://[::1]:8000',
    ]) {
      expect(checkEndpoint(endpoint), endpoint).toEqual({ ok: true })
    }
  })

  it('refuses plain http to a remote host without explicit consent', () => {
    // The whole point of a typo in a hostname is that it does not look like a typo.
    // Sending terminal text over cleartext to it is the failure this prevents.
    const verdict = checkEndpoint('http://api.example.test/v1')
    expect(verdict).toMatchObject({ ok: false, reason: 'plaintext-remote' })
  })

  it('allows plain http to a remote host once the user confirms', () => {
    expect(checkEndpoint('http://api.example.test/v1', true)).toEqual({ ok: true })
  })

  it('refuses a scheme that is not http(s)', () => {
    for (const endpoint of ['file:///etc/passwd', 'ftp://x.test', 'javascript:alert(1)']) {
      expect(checkEndpoint(endpoint), endpoint).toMatchObject({
        ok: false,
        reason: 'unsupported-scheme',
      })
    }
  })

  it('refuses something that is not a URL at all', () => {
    expect(checkEndpoint('not a url')).toMatchObject({ ok: false, reason: 'not-a-url' })
    expect(checkEndpoint('')).toMatchObject({ ok: false, reason: 'not-a-url' })
  })
})

describe('profile validation', () => {
  it('accepts a complete profile', () => {
    expect(validateProfile(profile())).toBeNull()
  })

  it('requires a name and a model id', () => {
    expect(validateProfile(profile({ name: '  ' }))).toMatchObject({ field: 'name' })
    expect(validateProfile(profile({ modelId: '' }))).toMatchObject({ field: 'modelId' })
  })

  it('rejects an endpoint that would send text in the clear', () => {
    expect(validateProfile(profile({ endpoint: 'http://remote.test/v1' }))).toMatchObject({
      field: 'endpoint',
    })
    // ...unless the caller confirms.
    expect(
      validateProfile(profile({ endpoint: 'http://remote.test/v1' }), {
        allowPlaintextRemote: true,
      }),
    ).toBeNull()
  })

  it('bounds every number', () => {
    const cases: Array<[Partial<ModelProfilePublic>, string]> = [
      [{ maxOutputTokens: 0 }, 'maxOutputTokens'],
      [{ maxOutputTokens: PROFILE_LIMITS.maxOutputTokens.max + 1 }, 'maxOutputTokens'],
      [{ maxOutputTokens: 1.5 }, 'maxOutputTokens'],
      [{ timeoutMs: 0 }, 'timeoutMs'],
      [{ timeoutMs: PROFILE_LIMITS.timeoutMs.max + 1 }, 'timeoutMs'],
      [{ temperature: -0.1 }, 'temperature'],
      [{ temperature: 2.1 }, 'temperature'],
    ]
    for (const [overrides, field] of cases) {
      expect(validateProfile(profile(overrides)), JSON.stringify(overrides)).toMatchObject({ field })
    }
  })

  it('treats a null temperature as "unset", not as zero', () => {
    // Sending 0.0 would make a model deterministic; omitting it is a different request.
    expect(validateProfile(profile({ temperature: null }))).toBeNull()
    expect(validateProfile(profile({ temperature: 0 }))).toBeNull()
  })
})

describe('usability', () => {
  it('is unusable when disabled, however complete', () => {
    expect(profileUsable(profile({ enabled: false }))).toBe(false)
    expect(profileProblem(profile({ enabled: false }))).toMatch(/turned off/i)
  })

  it('is unusable with a plaintext remote endpoint', () => {
    const p = profile({ endpoint: 'http://remote.test/v1' })
    expect(profileUsable(p)).toBe(false)
    expect(profileProblem(p)).toMatch(/plain HTTP/i)
  })

  it('is usable with a complete https profile', () => {
    expect(profileUsable(profile())).toBe(true)
    expect(profileProblem(profile())).toBeNull()
  })
})

describe('secret namespace', () => {
  it('names the profile, never the key', () => {
    expect(modelSecretResource('p-1')).toEqual({ type: 'model', id: 'p-1' })
  })
})

describe('the public type carries no key field', () => {
  it('has no apiKey property to write one into', () => {
    // A rule saying "do not store the key here" is weaker than a type with nowhere to
    // put it. This asserts the shape, not a convention.
    expect(Object.keys(profile())).not.toContain('apiKey')
    expect(Object.keys(profile())).not.toContain('key')
    expect(Object.keys(profile())).toContain('secretRef')
  })
})
