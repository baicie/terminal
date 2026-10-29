import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import { profileForHost, startTerminalShell } from './terminal-launcher'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

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

beforeEach(() => vi.mocked(invoke).mockReset())

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

describe('startTerminalShell startup deadline IPC', () => {
  beforeEach(() => vi.mocked(invoke).mockResolvedValue('session-id'))

  it.each([
    ['password', 'session_create_ssh_password'],
    ['key', 'session_create_ssh_key'],
    ['agent', 'session_create_ssh_agent'],
    ['cert', 'session_create_ssh_cert'],
  ] as const)(
    'passes an integer timeout through %s authentication',
    async (authType, command) => {
      await startTerminalShell(
        'remote',
        host({ authType }),
        undefined,
        80,
        24,
        undefined,
        undefined,
        undefined,
        undefined,
        1_234,
      )

      expect(invoke).toHaveBeenCalledWith(
        command,
        expect.objectContaining({ connectionTimeoutMs: 1_234 }),
      )
    },
  )

  it('passes the remaining timeout through the jump-host command', async () => {
    const target = host({ jumpHostId: 'jump-1' })
    const jump = host({ id: 'jump-1' })

    await startTerminalShell(
      'remote',
      target,
      undefined,
      80,
      24,
      jump,
      undefined,
      undefined,
      undefined,
      1_234,
    )

    expect(invoke).toHaveBeenCalledWith(
      'session_create_ssh_jump',
      expect.objectContaining({ connectionTimeoutMs: 1_234 }),
    )
  })
})
