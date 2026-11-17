/**
 * AI model profiles: the non-secret half of an assistant configuration.
 *
 * ## What this module is careful about
 *
 * A profile is *configuration*, and configuration is the part that can live in
 * SQLite. The API key is not configuration — it is a secret, and it goes to a
 * Credential Provider under the `model:<profileId>:<version>:apiKey` namespace, the
 * same boundary hosts and SSH keys use. `ModelProfilePublic` therefore has a
 * `secretRef` and no `apiKey`: there is no field a caller could accidentally persist
 * a key into, which is a stronger guarantee than a rule saying not to.
 *
 * The type is named `…Public` for the same reason the boundary names its counterpart
 * — a reader should be able to tell from the type alone that nothing secret is in it.
 *
 * ## Endpoint rules, and why they are not just validation
 *
 * An endpoint decides where the user's selected terminal text goes. That makes it a
 * security-relevant field, not a formatting one:
 *
 * - HTTPS is allowed.
 * - Plain HTTP to loopback is allowed, because a local model server on
 *   `127.0.0.1:11434` is a normal setup and the traffic never leaves the machine.
 * - Plain HTTP anywhere else is refused by default and requires an explicit
 *   confirmation, because the whole point of a typo in a hostname is that it does
 *   not look like a typo.
 *
 * These are checked in one place so a test can assert them and a UI can explain them,
 * rather than each call site deciding what "safe endpoint" means.
 */

/** How a profile talks to its model. */
export const AI_PROVIDERS = ['openai-compatible', 'anthropic', 'local'] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

/**
 * A model profile without secrets.
 *
 * `secretRef` names where the key lives; it never contains the key.
 */
export interface ModelProfilePublic {
  id: string
  name: string
  provider: AiProvider
  endpoint: string
  modelId: string
  temperature: number | null
  maxOutputTokens: number
  timeoutMs: number
  streaming: boolean
  /** `model:<profileId>:<version>:apiKey`, or null when no key is stored. */
  secretRef: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/**
 * What the UI can say about a profile right now.
 *
 * `unconfigured` and `requires-key` are different states with different next steps:
 * a profile with no endpoint is not fixed by adding a key, and a profile with no key
 * is not fixed by changing the endpoint.
 */
export type ModelProfileStatus =
  | 'unconfigured'
  | 'requires-key'
  | 'testing'
  | 'reachable'
  | 'unauthorized'
  | 'rate-limited'
  | 'offline'
  | 'timeout'
  | 'unsupported'

export type EndpointVerdict =
  | { ok: true }
  | { ok: false; reason: 'not-a-url' | 'unsupported-scheme' }
  | {
      ok: false
      reason: 'plaintext-remote'
      /** The URL, so a confirmation dialog can show exactly what would be sent to. */
      endpoint: string
    }

/** Accepts loopback by name and by address, including the IPv6 form. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
    return true
  }
  // 127.0.0.0/8 — the whole range is loopback, not just .1
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/**
 * Decide whether a profile's endpoint is acceptable.
 *
 * `allowPlaintextRemote` is the user's explicit confirmation. It is a parameter
 * rather than a module flag so the decision is visible at the call site and can be
 * tested in both directions.
 */
export function checkEndpoint(
  endpoint: string,
  allowPlaintextRemote = false,
): EndpointVerdict {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, reason: 'not-a-url' }
  }
  if (url.protocol === 'https:') return { ok: true }
  if (url.protocol !== 'http:') {
    return { ok: false, reason: 'unsupported-scheme' }
  }
  // Plain HTTP. Loopback is a local model server; anything else needs consent.
  if (isLoopbackHost(url.hostname)) return { ok: true }
  if (allowPlaintextRemote) return { ok: true }
  return { ok: false, reason: 'plaintext-remote', endpoint }
}

/** Limits a profile's numbers must satisfy, stated once so validation and UI agree. */
export const PROFILE_LIMITS = {
  maxOutputTokens: { min: 1, max: 32_000 },
  timeoutMs: { min: 1_000, max: 300_000 },
  temperature: { min: 0, max: 2 },
  nameLength: { min: 1, max: 100 },
  modelIdLength: { min: 1, max: 200 },
} as const

export type ProfileProblem =
  | { field: 'name'; reason: string }
  | { field: 'endpoint'; reason: string }
  | { field: 'modelId'; reason: string }
  | { field: 'maxOutputTokens'; reason: string }
  | { field: 'timeoutMs'; reason: string }
  | { field: 'temperature'; reason: string }

/**
 * Validate a profile before it is saved.
 *
 * Returns the first problem rather than a list: a form shows one error at a time,
 * and a caller that wants all of them can call field-by-field helpers. Returning the
 * first is the shape that cannot be half-handled.
 */
export function validateProfile(
  profile: Pick<
    ModelProfilePublic,
    'name' | 'endpoint' | 'modelId' | 'maxOutputTokens' | 'timeoutMs' | 'temperature'
  >,
  options: { allowPlaintextRemote?: boolean } = {},
): ProfileProblem | null {
  const name = profile.name.trim()
  if (name.length < PROFILE_LIMITS.nameLength.min) {
    return { field: 'name', reason: 'A profile needs a name.' }
  }
  if (name.length > PROFILE_LIMITS.nameLength.max) {
    return { field: 'name', reason: `A name is at most ${PROFILE_LIMITS.nameLength.max} characters.` }
  }

  const modelId = profile.modelId.trim()
  if (modelId.length < PROFILE_LIMITS.modelIdLength.min) {
    return { field: 'modelId', reason: 'A profile needs a model id.' }
  }
  if (modelId.length > PROFILE_LIMITS.modelIdLength.max) {
    return { field: 'modelId', reason: `A model id is at most ${PROFILE_LIMITS.modelIdLength.max} characters.` }
  }

  const endpoint = checkEndpoint(profile.endpoint, options.allowPlaintextRemote ?? false)
  if (!endpoint.ok) {
    const reason =
      endpoint.reason === 'not-a-url'
        ? 'That is not a valid URL.'
        : endpoint.reason === 'unsupported-scheme'
          ? 'Use https://, or http:// for a local server.'
          : 'Plain HTTP would send your terminal text unencrypted. Use HTTPS, or confirm you trust this endpoint.'
    return { field: 'endpoint', reason }
  }

  if (
    !Number.isInteger(profile.maxOutputTokens) ||
    profile.maxOutputTokens < PROFILE_LIMITS.maxOutputTokens.min ||
    profile.maxOutputTokens > PROFILE_LIMITS.maxOutputTokens.max
  ) {
    return {
      field: 'maxOutputTokens',
      reason: `Max output tokens must be between ${PROFILE_LIMITS.maxOutputTokens.min} and ${PROFILE_LIMITS.maxOutputTokens.max}.`,
    }
  }

  if (
    !Number.isInteger(profile.timeoutMs) ||
    profile.timeoutMs < PROFILE_LIMITS.timeoutMs.min ||
    profile.timeoutMs > PROFILE_LIMITS.timeoutMs.max
  ) {
    return {
      field: 'timeoutMs',
      reason: `Timeout must be between ${PROFILE_LIMITS.timeoutMs.min} and ${PROFILE_LIMITS.timeoutMs.max} ms.`,
    }
  }

  if (profile.temperature !== null) {
    if (
      !Number.isFinite(profile.temperature) ||
      profile.temperature < PROFILE_LIMITS.temperature.min ||
      profile.temperature > PROFILE_LIMITS.temperature.max
    ) {
      return {
        field: 'temperature',
        reason: `Temperature must be between ${PROFILE_LIMITS.temperature.min} and ${PROFILE_LIMITS.temperature.max}, or empty.`,
      }
    }
  }

  return null
}

/** The provider resource namespace for a profile's key. */
export function modelSecretResource(profileId: string): { type: 'model'; id: string } {
  return { type: 'model', id: profileId }
}

/**
 * A profile that can actually be used for a request.
 *
 * The single predicate the generate path and the UI both consult, so "the button
 * looked enabled" and "the request was allowed" cannot disagree.
 */
export function profileUsable(profile: ModelProfilePublic): boolean {
  if (!profile.enabled) return false
  if (!profile.endpoint || !profile.modelId) return false
  // Only the *strict* verdict counts here. An earlier version wrote
  // `checkEndpoint(p).ok || checkEndpoint(p, true).ok`, and the second call allows
  // every plaintext endpoint — so the guard allowed exactly what it existed to stop.
  // An explicitly-confirmed plaintext endpoint is recorded on the profile (by saving
  // it with `allowPlaintextRemote`), and re-checking strictly here is what keeps a
  // profile that was saved before that confirmation from becoming usable silently.
  return checkEndpoint(profile.endpoint).ok
}

/** Why a profile cannot be used, for the UI to explain rather than grey out silently. */
export function profileProblem(profile: ModelProfilePublic): string | null {
  if (!profile.enabled) return 'This profile is turned off.'
  if (!profile.endpoint) return 'This profile has no endpoint.'
  if (!profile.modelId) return 'This profile has no model id.'
  const verdict = checkEndpoint(profile.endpoint)
  if (!verdict.ok && verdict.reason === 'plaintext-remote') {
    return 'This endpoint uses plain HTTP. Turn it on again to confirm you trust it.'
  }
  if (!verdict.ok) return 'This endpoint is not valid.'
  return null
}
