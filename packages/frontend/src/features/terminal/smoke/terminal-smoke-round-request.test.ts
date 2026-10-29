import { describe, expect, it } from 'vitest'
import { terminalSmokeTestConfig } from './terminal-smoke-test-fixtures'
import {
  terminalSmokeRequest,
  terminalSmokeTabId,
} from './terminal-smoke-round-request'
import type { TerminalSmokeConfig } from './terminal-smoke-contract'

const baseSsh = terminalSmokeTestConfig.ssh
const privateKey = baseSsh.privateKey as string

function configWith(overrides: Partial<TerminalSmokeConfig['ssh']>): TerminalSmokeConfig {
  return {
    ...terminalSmokeTestConfig,
    ssh: { ...baseSsh, ...overrides },
  }
}

describe('terminalSmokeTabId', () => {
  it('derives a stable per-round tab id', () => {
    expect(terminalSmokeTabId(0)).toBe('terminal-smoke-ssh-1')
    expect(terminalSmokeTabId(9)).toBe('terminal-smoke-ssh-10')
  })
})

describe('terminalSmokeRequest', () => {
  it('builds a public-key host for key mode', () => {
    const request = terminalSmokeRequest(terminalSmokeTestConfig, 3)

    expect(request.tabType).toBe('remote')
    expect(request.tabId).toBe('terminal-smoke-ssh-4')
    expect(request.host).toMatchObject({
      authType: 'key',
      hostname: '127.0.0.1',
      port: 42_222,
      privateKey,
      username: 'terminal-smoke',
    })
    expect(request.host?.jumpHostId).toBeUndefined()
    expect(request.expectedHostKey).toBe(baseSsh.expectedHostKey)
    expect(request.jumpHost).toBeUndefined()
  })

  it('builds a password host without a private key', () => {
    const request = terminalSmokeRequest(
      configWith({
        authMode: 'password',
        privateKey: null,
        password: 'terminal-smoke-password',
      }),
      0,
    )

    expect(request.host).toMatchObject({
      authType: 'password',
      password: 'terminal-smoke-password',
    })
    expect(request.host?.privateKey).toBeUndefined()
  })

  it('builds an agent host without local credentials', () => {
    const request = terminalSmokeRequest(
      configWith({ authMode: 'agent', privateKey: null }),
      0,
    )

    expect(request.host).toMatchObject({ authType: 'agent' })
    expect(request.host?.privateKey).toBeUndefined()
  })

  it('builds a certificate host with certificate, key and optional passphrase', () => {
    const certificate = 'ssh-ed25519-cert-v01@openssh.com AAAAcertificate'
    const request = terminalSmokeRequest(
      configWith({
        authMode: 'cert',
        certificate,
        password: 'cert-passphrase',
      }),
      0,
    )

    expect(request.host).toMatchObject({
      authType: 'cert',
      certificate,
      privateKey,
      password: 'cert-passphrase',
    })
  })

  it('wires the jump host target and expected jump key for the jump case', () => {
    const jump = {
      host: '127.0.0.1',
      port: 42_223,
      username: 'terminal-smoke',
      privateKey:
        '-----BEGIN OPENSSH PRIVATE KEY-----\njump-key\n-----END OPENSSH PRIVATE KEY-----\n',
      expectedHostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfixtureJump',
    }
    const request = terminalSmokeRequest(configWith({ jump }), 2)

    expect(request.host).toMatchObject({
      authType: 'key',
      jumpHostId: 'terminal-smoke-jump',
    })
    expect(request.expectedJumpHostKey).toBe(jump.expectedHostKey)
    expect(request.jumpHost).toMatchObject({
      authType: 'key',
      hostname: '127.0.0.1',
      port: 42_223,
      privateKey: jump.privateKey,
    })
  })
})
