import { beforeEach, describe, expect, it } from 'vitest'
import type { Host } from '@/types'
import {
  clearTemporaryTerminalProfiles,
  getTemporaryTerminalProfile,
  registerTemporaryTerminalProfile,
  removeTemporaryTerminalProfile,
} from './temporary-terminal-profiles'

const profile: Host = {
  id: 'quick-connect-host',
  name: 'Quick Connect',
  hostname: 'example.com',
  port: 22,
  username: 'alice',
  authType: 'password',
  password: 'not-persisted',
  isFavorite: false,
  portForwards: [],
  createdAt: 1,
  updatedAt: 1,
}

describe('temporary terminal profiles', () => {
  beforeEach(() => {
    clearTemporaryTerminalProfiles()
  })

  it('registers credentials behind an opaque in-memory profile ID', () => {
    const profileId = registerTemporaryTerminalProfile(profile)

    expect(profileId).toMatch(/^temporary-profile_/)
    expect(profileId).not.toContain(profile.password!)
    expect(getTemporaryTerminalProfile(profileId)).toEqual(profile)
  })

  it('removes a profile explicitly', () => {
    const profileId = registerTemporaryTerminalProfile(profile)

    removeTemporaryTerminalProfile(profileId)

    expect(getTemporaryTerminalProfile(profileId)).toBeUndefined()
  })
})
