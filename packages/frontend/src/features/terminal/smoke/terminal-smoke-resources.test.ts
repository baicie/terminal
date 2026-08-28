import { describe, expect, it, vi } from 'vitest'
import {
  parseTerminalSmokeBackendResources,
  waitForStableTerminalSmokeResources,
  type TerminalSmokeResourceSnapshot,
} from './terminal-smoke-resources'

function snapshot(
  sessionId: string | null,
): TerminalSmokeResourceSnapshot {
  const ids = sessionId === null ? [] : [sessionId]
  return {
    frontend: {
      recordTabIds: sessionId === null ? [] : [`tab-${sessionId}`],
      sessionMappings:
        sessionId === null
          ? []
          : [{ sessionId, tabId: `tab-${sessionId}` }],
    },
    backend: {
      managerSessions: ids,
      metadata: ids,
      channels: ids,
      sshPool: ids,
      sshRegistry: ids,
      outputControls: ids,
    },
  }
}

describe('waitForStableTerminalSmokeResources', () => {
  it('requires two consecutive exact baseline snapshots', async () => {
    const baseline = snapshot(null)
    const sameCountsWithDifferentKeys = snapshot('replacement')
    const read = vi
      .fn<() => Promise<TerminalSmokeResourceSnapshot>>()
      .mockResolvedValueOnce(sameCountsWithDifferentKeys)
      .mockResolvedValueOnce(baseline)
      .mockResolvedValueOnce(sameCountsWithDifferentKeys)
      .mockResolvedValueOnce(baseline)
      .mockResolvedValueOnce(baseline)

    await expect(
      waitForStableTerminalSmokeResources(read, {
        expected: baseline,
        sleep: async () => {},
      }),
    ).resolves.toEqual(baseline)
    expect(read).toHaveBeenCalledTimes(5)
  })

  it('captures a baseline only after two identical complete snapshots', async () => {
    const first = snapshot('first')
    const second = snapshot('second')
    const read = vi
      .fn<() => Promise<TerminalSmokeResourceSnapshot>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(second)

    await expect(
      waitForStableTerminalSmokeResources(read, { sleep: async () => {} }),
    ).resolves.toEqual(second)
    expect(read).toHaveBeenCalledTimes(3)
  })
})

describe('parseTerminalSmokeBackendResources', () => {
  it('accepts only the six exact resource key arrays', () => {
    expect(
      parseTerminalSmokeBackendResources({
        managerSessions: ['session-b', 'session-a'],
        metadata: [],
        channels: [],
        sshPool: [],
        sshRegistry: [],
        outputControls: [],
      }),
    ).toEqual({
      managerSessions: ['session-a', 'session-b'],
      metadata: [],
      channels: [],
      sshPool: [],
      sshRegistry: [],
      outputControls: [],
    })

    expect(() =>
      parseTerminalSmokeBackendResources({
        managerSessions: [],
        metadata: [],
        channels: [],
        sshPool: [],
        sshRegistry: [],
        outputControls: [],
        unexpected: [],
      }),
    ).toThrow('Invalid terminal smoke resource snapshot')
  })
})
