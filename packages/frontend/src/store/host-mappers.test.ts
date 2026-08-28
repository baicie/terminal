import { describe, expect, it } from 'vitest'
import { hostRowToHost, type HostRow } from './host-mappers'

describe('hostRowToHost', () => {
  it('restores certificate and jump host settings from SQLite', () => {
    const row: HostRow = {
      id: 'host-id',
      name: 'Host',
      hostname: 'host.example',
      port: 22,
      username: 'user',
      auth_type: 'cert',
      password: null,
      private_key: 'private-key',
      certificate: 'certificate',
      group_id: null,
      is_favorite: 0,
      color: null,
      tags: null,
      port_forwards: null,
      startup_command: null,
      environment: null,
      jump_host_id: 'jump-id',
      jump_host_auth_type: 'agent',
      agent_forwarding: 1,
      created_at: 1,
      updated_at: 2,
    }

    expect(hostRowToHost(row)).toMatchObject({
      certificate: 'certificate',
      jumpHostId: 'jump-id',
      jumpHostAuthType: 'agent',
      agentForwarding: true,
    })
  })
})
