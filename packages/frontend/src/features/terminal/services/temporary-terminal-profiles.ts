import type { Host } from '@/types'
import { generatePrefixedId } from '@/utils/id'

const profiles = new Map<string, Host>()

export function registerTemporaryTerminalProfile(profile: Host): string {
  const profileId = generatePrefixedId('temporary-profile')
  profiles.set(profileId, profile)
  return profileId
}

export function getTemporaryTerminalProfile(
  profileId: string,
): Host | undefined {
  return profiles.get(profileId)
}

export function removeTemporaryTerminalProfile(profileId: string): void {
  profiles.delete(profileId)
}

/**
 * Drop the secrets from a profile while keeping the profile.
 *
 * A one-time credential is meant to stop existing once it has done its job. The tab
 * cannot simply lose its profile — `TerminalContainer` reads it to reconnect, and a
 * reconnect without a credential would fail for no reason the user could see. But the
 * plaintext has no business surviving the question it was typed to answer, and the
 * profile outlives that question by however long the tab stays open.
 *
 * So the connection keeps its identity and loses its password. A reconnect of a tab
 * whose secret was dropped will ask again, which is the honest behaviour: the user
 * answered "do not store this", and nothing did.
 */
export function scrubTemporaryTerminalProfileSecrets(profileId: string): void {
  const profile = profiles.get(profileId)
  if (!profile) return
  // `Host` holds the key's passphrase in `password` (that is the field the SSH layer
  // reads it from), so clearing the two secret fields clears all of it.
  profiles.set(profileId, {
    ...profile,
    password: undefined,
    privateKey: undefined,
  })
}

export function clearTemporaryTerminalProfiles(): void {
  profiles.clear()
}
