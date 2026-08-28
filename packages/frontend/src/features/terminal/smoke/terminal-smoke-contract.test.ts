import { describe, expect, it, vi } from 'vitest'
import {
  emitTerminalSmokeStaleOutput,
  isTerminalSmokeTauriRuntime,
  loadTerminalSmokeConfig,
  parseTerminalSmokeConfig,
  reportTerminalSmokeConnected,
} from './terminal-smoke-contract'

const validConfig = {
  loadBytes: 8_388_608,
  initialCols: 80,
  initialRows: 24,
  targetCols: 97,
  targetRows: 31,
  timeoutMs: 180_000,
  rounds: 10,
  reconnectRequired: false,
  ssh: {
    host: '127.0.0.1',
    port: 42_222,
    username: 'terminal-smoke',
    privateKey:
      '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----\n',
    expectedHostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIfixture',
  },
}

it('recognizes the Tauri internals injected into desktop webviews', () => {
  expect(
    isTerminalSmokeTauriRuntime({ __TAURI_INTERNALS__: {} }),
  ).toBe(true)
  expect(isTerminalSmokeTauriRuntime({})).toBe(false)
})

it('recognizes the macOS production Tauri protocol', () => {
  expect(
    isTerminalSmokeTauriRuntime({ location: { protocol: 'tauri:' } }),
  ).toBe(true)
})

describe('loadTerminalSmokeConfig', () => {
  it('does not invoke Tauri outside a Tauri webview', async () => {
    const invoke = vi.fn()

    const result = await loadTerminalSmokeConfig({
      isTauri: () => false,
      invoke,
    })

    expect(result).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns null when the Rust smoke mode is disabled', async () => {
    const result = await loadTerminalSmokeConfig({
      isTauri: () => true,
      invoke: vi.fn().mockResolvedValue(null),
    })

    expect(result).toBeNull()
  })

  it('parses the fixed Rust smoke contract', async () => {
    const result = await loadTerminalSmokeConfig({
      isTauri: () => true,
      invoke: vi.fn().mockResolvedValue(validConfig),
    })

    expect(result).toEqual(validConfig)
  })
})

describe('parseTerminalSmokeConfig', () => {
  it.each([
    { ...validConfig, loadBytes: 8_388_607 },
    { ...validConfig, initialCols: 0 },
    { ...validConfig, targetRows: 31.5 },
    { ...validConfig, timeoutMs: 165_000 },
    { ...validConfig, rounds: 9 },
    { ...validConfig, ssh: { ...validConfig.ssh, host: 'localhost' } },
    { ...validConfig, ssh: { ...validConfig.ssh, port: 0 } },
    { ...validConfig, resultPath: '/tmp/result.json' },
  ])('rejects a config outside the exact public contract', raw => {
    expect(() => parseTerminalSmokeConfig(raw)).toThrow(
      'Invalid terminal smoke config',
    )
  })
})

describe('reportTerminalSmokeConnected', () => {
  it('records the connection checkpoint against the Rust application clock', async () => {
    const invoke = vi.fn().mockResolvedValue(9_999)

    await expect(reportTerminalSmokeConnected({ invoke })).resolves.toBe(9_999)
    expect(invoke).toHaveBeenCalledWith('terminal_smoke_connected')
  })

  it.each([-1, 10_000.5, '9999', null])(
    'rejects an invalid elapsed value from Rust: %s',
    async elapsed => {
      await expect(
        reportTerminalSmokeConnected({
          invoke: vi.fn().mockResolvedValue(elapsed),
        }),
      ).rejects.toThrow('Invalid terminal smoke connection checkpoint')
    },
  )
})

describe('emitTerminalSmokeStaleOutput', () => {
  it('requests a causal stale-output probe for the retired and active sessions', async () => {
    const invoke = vi.fn().mockResolvedValue({
      staleMarker: 'TERMINAL_SMOKE_STALE_OUTPUT_CANARY',
      barrierMarker: 'TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER',
    })

    await expect(
      emitTerminalSmokeStaleOutput(
        'ssh-session-before-reconnect',
        'ssh-session-after-reconnect',
        { invoke },
      ),
    ).resolves.toEqual({
      staleMarker: 'TERMINAL_SMOKE_STALE_OUTPUT_CANARY',
      barrierMarker: 'TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER',
    })
    expect(invoke).toHaveBeenCalledWith('terminal_smoke_emit_stale_output', {
      retiredSessionId: 'ssh-session-before-reconnect',
      activeSessionId: 'ssh-session-after-reconnect',
    })
  })

  it.each([
    null,
    {},
    { staleMarker: '', barrierMarker: 'barrier' },
    { staleMarker: 'same', barrierMarker: 'same' },
    { staleMarker: 'stale', barrierMarker: 'barrier', extra: true },
  ])('rejects an invalid Rust stale-output probe contract', async raw => {
    await expect(
      emitTerminalSmokeStaleOutput('retired', 'active', {
        invoke: vi.fn().mockResolvedValue(raw),
      }),
    ).rejects.toThrow('Invalid terminal smoke stale-output probe')
  })
})
