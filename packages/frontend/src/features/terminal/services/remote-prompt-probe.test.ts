import { describe, expect, it, vi } from 'vitest'
import {
  loadRemotePromptProbeConfig,
  parseRemotePromptProbeConfig,
} from './remote-prompt-probe'

describe('remote prompt probe contract', () => {
  it('accepts a bounded marker and command', () => {
    expect(
      parseRemotePromptProbeConfig({
        marker: 'REMOTE_PROMPT_MARKER',
        command: "printf '%s\\n' REMOTE_PROMPT_MARKER",
      }),
    ).toEqual({
      marker: 'REMOTE_PROMPT_MARKER',
      command: "printf '%s\\n' REMOTE_PROMPT_MARKER",
    })
  })

  it('accepts optional end-to-end shell evidence expectations', () => {
    expect(
      parseRemotePromptProbeConfig({
        marker: 'REMOTE_PROMPT_MARKER',
        command: 'false; printf marker',
        expectedCwd: '/tmp/fixture/home',
        expectedExitCode: 1,
      }),
    ).toEqual({
      marker: 'REMOTE_PROMPT_MARKER',
      command: 'false; printf marker',
      expectedCwd: '/tmp/fixture/home',
      expectedExitCode: 1,
    })
  })

  it('fails closed for unknown fields and control characters', () => {
    expect(() =>
      parseRemotePromptProbeConfig({
        marker: 'REMOTE_PROMPT_MARKER',
        command: 'printf ok',
        extra: true,
      }),
    ).toThrow(/configuration/)
    expect(() =>
      parseRemotePromptProbeConfig({ marker: 'bad\nmarker', command: 'printf ok' }),
    ).toThrow(/configuration/)
  })

  it('does not invoke Tauri when running outside the desktop runtime', async () => {
    const invoke = vi.fn()

    await expect(
      loadRemotePromptProbeConfig({ isTauri: () => false, invoke }),
    ).resolves.toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('loads the config through Tauri when the desktop runtime is present', async () => {
    const invoke = vi.fn().mockResolvedValue({
      marker: 'REMOTE_PROMPT_MARKER',
      command: "printf '%s\\n' REMOTE_PROMPT_MARKER",
    })

    await expect(
      loadRemotePromptProbeConfig({ isTauri: () => true, invoke }),
    ).resolves.toEqual({
      marker: 'REMOTE_PROMPT_MARKER',
      command: "printf '%s\\n' REMOTE_PROMPT_MARKER",
    })
    expect(invoke).toHaveBeenCalledWith('remote_prompt_probe_config')
  })
})

