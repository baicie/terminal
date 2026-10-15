import { describe, expect, it } from 'vitest'
import type { Host } from '@/types'
import { profileForHost } from './terminal-launcher'

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'host-1',
    name: 'Host',
    hostname: 'example.test',
    port: 22,
    username: 'user',
    authType: 'password',
    portForwards: [],
    isFavorite: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('profileForHost', () => {
  it('keeps the remote profile absent when integration is disabled', () => {
    expect(profileForHost(host())).toBeUndefined()
    expect(profileForHost(host({ shellIntegration: 'off' }))).toBeUndefined()
  })

  it('passes an explicit shell integration mode even without other profile fields', () => {
    expect(profileForHost(host({ shellIntegration: 'bash' }))).toEqual({
      shellIntegration: 'bash',
    })
  })

  it('trims startup commands while preserving the selected integration mode', () => {
    expect(
      profileForHost(
        host({ startupCommand: '  cd ~/project  ', shellIntegration: 'zsh' }),
      ),
    ).toEqual({
      startupCommand: 'cd ~/project',
      shellIntegration: 'zsh',
    })
  })
})
