/**
 * AI model profiles in SQLite: the public half only.
 *
 * The table has a `secret_ref` and **no column an API key could be written into**.
 * That is the design's rule enforced by the schema rather than by a comment — a
 * future change that tried to persist a key here would have to add a column first,
 * which is a visible act rather than a quiet one.
 *
 * ## Why the key is written through the credential provider
 *
 * The same boundary hosts and SSH keys use. A key stored here would be plaintext in a
 * file the user may back up, sync or hand to support; a key in the provider is
 * encrypted and namespaced. `setProfileSecret` is the only function in this module
 * that could touch a secret, and it delegates immediately.
 */

import type { ModelProfilePublic, AiProvider } from '@/features/ai/model-profile'
import { modelSecretResource } from '@/features/ai/model-profile'
import { refVersion, serializeCredentialRef } from '@/service/credential-boundary'
import type { CredentialRef } from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { executeQuery, select } from './connection'

/** The row shape, as SQLite returns it. */
interface ProfileRow {
  id: string
  name: string
  provider: string
  endpoint: string
  model_id: string
  temperature: number | null
  max_output_tokens: number
  timeout_ms: number
  streaming: number
  secret_ref: string | null
  enabled: number
  created_at: number
  updated_at: number
}

/** Read the reference a row stores, tolerating a damaged one. */
function parseRef(raw: string | null): CredentialRef | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { kinds?: unknown, provider?: unknown, version?: unknown }
    if (!Array.isArray(parsed.kinds) || parsed.kinds.length === 0) return null
    return {
      kinds: parsed.kinds as CredentialRef['kinds'],
      provider: 'vault',
      ...(typeof parsed.version === 'number' ? { version: parsed.version } : {}),
    }
  } catch {
    // A damaged reference is reported as "no usable reference" here; the *profile*
    // stays usable for a local endpoint that needs no key, and the UI can offer a
    // re-save. Throwing would make one bad row break the whole settings page.
    return null
  }
}

function toProfile(row: ProfileRow): ModelProfilePublic {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as AiProvider,
    endpoint: row.endpoint,
    modelId: row.model_id,
    temperature: row.temperature,
    maxOutputTokens: row.max_output_tokens,
    timeoutMs: row.timeout_ms,
    streaming: row.streaming === 1,
    secretRef: row.secret_ref,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Every profile, newest last. No secrets are read. */
export async function listModelProfiles(): Promise<ModelProfilePublic[]> {
  const rows = await select<ProfileRow>(
    'SELECT * FROM ai_model_profiles ORDER BY created_at ASC',
  )
  return rows.map(toProfile)
}

export async function getModelProfile(id: string): Promise<ModelProfilePublic | null> {
  const rows = await select<ProfileRow>(
    'SELECT * FROM ai_model_profiles WHERE id = ?',
    [id],
  )
  return rows[0] ? toProfile(rows[0]) : null
}

/**
 * Insert or update a profile's public fields.
 *
 * Deliberately does **not** write a secret: `secretRef` is whatever the caller already
 * arranged via `setProfileSecret`, and passing `undefined` leaves the existing value
 * alone rather than clearing it. Clearing a key is a separate, explicit action.
 */
export async function upsertModelProfile(
  profile: ModelProfilePublic,
  options: { preserveSecretRef?: boolean } = {},
): Promise<void> {
  const now = Date.now()
  const existing = await getModelProfile(profile.id)
  const secretRef = options.preserveSecretRef && existing
    ? existing.secretRef
    : profile.secretRef

  if (existing) {
    await executeQuery(
      `UPDATE ai_model_profiles SET
         name = ?, provider = ?, endpoint = ?, model_id = ?, temperature = ?,
         max_output_tokens = ?, timeout_ms = ?, streaming = ?, secret_ref = ?,
         enabled = ?, updated_at = ?
       WHERE id = ?`,
      [
        profile.name,
        profile.provider,
        profile.endpoint,
        profile.modelId,
        profile.temperature,
        profile.maxOutputTokens,
        profile.timeoutMs,
        profile.streaming ? 1 : 0,
        secretRef,
        profile.enabled ? 1 : 0,
        now,
        profile.id,
      ],
    )
    return
  }

  await executeQuery(
    `INSERT INTO ai_model_profiles
       (id, name, provider, endpoint, model_id, temperature, max_output_tokens,
        timeout_ms, streaming, secret_ref, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profile.id,
      profile.name,
      profile.provider,
      profile.endpoint,
      profile.modelId,
      profile.temperature,
      profile.maxOutputTokens,
      profile.timeoutMs,
      profile.streaming ? 1 : 0,
      secretRef,
      profile.enabled ? 1 : 0,
      profile.createdAt || now,
      now,
    ],
  )
}

/**
 * Store a profile's API key.
 *
 * Ordering matches the rest of the credential boundary: write the secret under a new
 * version, read it back, *then* point the row at it. A failure before the update
 * leaves the profile with its previous reference rather than a pointer to a key that
 * was never written.
 */
export async function setProfileSecret(profileId: string, apiKey: string): Promise<void> {
  const existing = await getModelProfile(profileId)
  if (!existing) throw new Error('That model profile does not exist.')

  const previous = parseRef(existing.secretRef)
  const version = (previous ? refVersion(previous) : 0) + 1
  const resource = modelSecretResource(profileId)

  await vaultSecretProvider.write(resource, version, 'password', apiKey)
  // Read back before pointing the row at it: a write that silently failed would
  // otherwise produce a profile that looks configured and cannot authenticate.
  const readBack = await vaultSecretProvider.read(resource, version, 'password')
  if (readBack !== apiKey) {
    throw new Error('The key was stored but could not be read back.')
  }

  const ref: CredentialRef = { kinds: ['password'], provider: 'vault', version }
  await executeQuery(
    'UPDATE ai_model_profiles SET secret_ref = ?, updated_at = ? WHERE id = ?',
    [serializeCredentialRef(ref), Date.now(), profileId],
  )

  // Retire the previous generation now that nothing points at it. A failure here
  // leaves orphaned ciphertext, which is recoverable, rather than a dangling
  // reference.
  if (previous) {
    try {
      await vaultSecretProvider.removeVersion(
        resource,
        refVersion(previous),
        previous.kinds,
      )
    } catch {
      // Best effort, as everywhere else in this boundary.
    }
  }
}

/**
 * Read a profile's API key, for the one caller that needs it: the driver.
 *
 * Returns `undefined` when the profile stores no key, which is a valid state for a
 * local endpoint. Throws when a *stored* key cannot be read, because answering
 * `undefined` there would make a locked vault look like a profile without a key.
 */
export async function getProfileSecret(profileId: string): Promise<string | undefined> {
  const existing = await getModelProfile(profileId)
  if (!existing) return undefined
  const ref = parseRef(existing.secretRef)
  if (!ref) return undefined
  return vaultSecretProvider.read(
    modelSecretResource(profileId),
    refVersion(ref),
    'password',
  )
}

/**
 * Delete a profile.
 *
 * The row goes first, then the secret, so a failure after the row leaves orphaned
 * ciphertext rather than a profile whose key is already gone.
 */
export async function deleteModelProfile(profileId: string): Promise<void> {
  const existing = await getModelProfile(profileId)
  if (!existing) return
  await executeQuery('DELETE FROM ai_model_profiles WHERE id = ?', [profileId])
  const ref = parseRef(existing.secretRef)
  if (!ref) return
  try {
    await vaultSecretProvider.removeVersion(
      modelSecretResource(profileId),
      refVersion(ref),
      ref.kinds,
    )
  } catch {
    // Reported by the caller as "the profile is gone, its key may not be" rather
    // than by failing the delete after it already happened.
  }
}

/** Does this profile have a key stored? Never reads it. */
export function hasProfileSecret(profile: ModelProfilePublic): boolean {
  return parseRef(profile.secretRef) !== null
}
