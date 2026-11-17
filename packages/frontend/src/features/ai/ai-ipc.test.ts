// The renderer's half of the AI IPC boundary.
//
// What this pins: the request carries no secret, a refusal resolves rather than
// throwing, an unknown command becomes "AI is not enabled in this build", and the
// channel is the only path events take.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

/** A stand-in for `Channel` that records the handler a caller installs. */
class FakeChannel<T> {
  static instances: FakeChannel<unknown>[] = []
  onmessage: (event: T) => void = () => undefined
  constructor() {
    FakeChannel.instances.push(this as FakeChannel<unknown>)
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  Channel: FakeChannel,
}))

const { cancelRun, contextForIpc, generate, isAvailable, listProfiles } = await import('./ai-ipc')

function context(text = 'kubectl get pods') {
  return { text, contentSha256: 'abc123', approved: true as const }
}

beforeEach(() => {
  mocks.invoke.mockReset()
  FakeChannel.instances.length = 0
})

describe('profiles', () => {
  it('asks the backend for the public list', async () => {
    mocks.invoke.mockResolvedValue([
      { id: 'p-1', provider: 'local', endpoint: 'http://127.0.0.1:11434/v1', hasKey: false },
    ])
    const profiles = await listProfiles()
    expect(mocks.invoke).toHaveBeenCalledWith('ai_profiles_list')
    expect(profiles[0]?.id).toBe('p-1')
  })

  it('reports an empty list — not an error — in a build without AI', async () => {
    mocks.invoke.mockRejectedValue(new Error('command ai_profiles_list not found'))
    expect(await listProfiles()).toEqual([])
  })

  it('rethrows a real failure, so a broken database is not shown as "no profiles"', async () => {
    mocks.invoke.mockRejectedValue(new Error('database is locked'))
    await expect(listProfiles()).rejects.toThrow(/database is locked/)
  })

  it('answers availability from the backend', async () => {
    mocks.invoke.mockResolvedValue(true)
    expect(await isAvailable()).toBe(true)
    mocks.invoke.mockRejectedValue(new Error('command ai_available not found'))
    expect(await isAvailable()).toBe(false)
  })
})

describe('generate', () => {
  it('sends the request shape the backend expects and installs the channel', async () => {
    mocks.invoke.mockResolvedValue({ sent: true })
    const onEvent = vi.fn()
    await generate(
      {
        requestId: 'run-1',
        profileId: 'p-1',
        action: 'explain-selection',
        context: context(),
      },
      onEvent,
    )
    const [command, args] = mocks.invoke.mock.calls[0]!
    expect(command).toBe('ai_generate')
    expect(args.request).toEqual({
      requestId: 'run-1',
      profileId: 'p-1',
      action: 'explain-selection',
      context: { text: 'kubectl get pods', contentSha256: 'abc123', approved: true },
    })
    // The channel is the only event path, and it is the one the caller handed us.
    expect(args.onEvent).toBe(FakeChannel.instances[0])
    expect(FakeChannel.instances[0]!.onmessage).toBe(onEvent)
  })

  it('resolves a refusal instead of throwing', async () => {
    // A refusal is a normal outcome the dock renders, not an exception.
    mocks.invoke.mockResolvedValue({
      sent: false,
      failure: { kind: 'context-changed', message: 'The text changed.' },
    })
    const outcome = await generate(
      { requestId: 'r', profileId: 'p', action: 'explain-summary' as never, context: context() },
      () => undefined,
    )
    expect(outcome.sent).toBe(false)
    expect(outcome.failure?.kind).toBe('context-changed')
  })

  it('turns an unknown command into a structured "feature disabled" outcome', async () => {
    mocks.invoke.mockRejectedValue(new Error('command ai_generate not found'))
    const outcome = await generate(
      { requestId: 'r', profileId: 'p', action: 'explain-selection', context: context() },
      () => undefined,
    )
    expect(outcome.sent).toBe(false)
    expect(outcome.failure?.kind).toBe('feature-disabled')
    expect(outcome.failure?.message).toMatch(/not enabled in this build/)
  })

  it('rethrows a failure that is not about a missing command', async () => {
    mocks.invoke.mockRejectedValue(new Error('window closed'))
    await expect(
      generate(
        { requestId: 'r', profileId: 'p', action: 'explain-selection', context: context() },
        () => undefined,
      ),
    ).rejects.toThrow(/window closed/)
  })
})

describe('cancel', () => {
  it('cancels by request id', async () => {
    mocks.invoke.mockResolvedValue(true)
    expect(await cancelRun('run-1')).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('ai_cancel', { requestId: 'run-1' })
  })

  it('is a no-op in a build without AI', async () => {
    // Nothing can be in flight there, so "nothing to cancel" is the honest answer.
    mocks.invoke.mockRejectedValue(new Error('command ai_cancel not found'))
    expect(await cancelRun('run-1')).toBe(false)
  })
})

describe('the context crossing the boundary', () => {
  it('carries the text and its digest and nothing else', () => {
    const payload = contextForIpc({
      kind: 'selection',
      hostId: 'h-1',
      sessionId: 'tab-1',
      bytes: 16,
      contentSha256: 'digest',
      preview: 'kubectl get pods',
      text: 'kubectl get pods',
      approved: true,
      redactionEdits: [],
    })
    expect(payload).toEqual({
      text: 'kubectl get pods',
      contentSha256: 'digest',
      approved: true,
    })
    expect(Object.keys(payload).sort()).toEqual(['approved', 'contentSha256', 'text'])
  })
})
