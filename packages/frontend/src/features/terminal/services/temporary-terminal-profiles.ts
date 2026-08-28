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

export function clearTemporaryTerminalProfiles(): void {
  profiles.clear()
}
