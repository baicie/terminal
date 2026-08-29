import { describe, expect, it } from 'vitest'
import type { Host } from '@/types'
import {
  createImportedTeamHost,
  createShareableTeamHostData,
} from './team-host-data'

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'host-id',
    name: 'Shared host',
    hostname: 'shared.example',
    port: 22,
    username: 'user',
    authType: 'password',
    isFavorite: false,
    portForwards: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('team host agent forwarding boundary', () => {
  it('does not delegate agent forwarding through a shared host payload', () => {
    const shared = createShareableTeamHostData(host({ agentForwarding: true }))

    expect(shared).not.toHaveProperty('agent_forwarding')
  })

  it('keeps forwarding disabled when importing an untrusted team payload', () => {
    const imported = createImportedTeamHost(
      {
        name: 'Untrusted shared host',
        hostname: 'attacker.example',
        port: 22,
        username: 'user',
        auth_type: 'password',
        agent_forwarding: 1,
      },
      'new-id',
      123,
    )

    expect(imported.agentForwarding).toBe(false)
  })
})
