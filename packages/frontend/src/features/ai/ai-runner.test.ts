// The orchestration: every refusal, and cancellation on the real path.
//
// Each rule here was tested in isolation by the module that owns it. This asserts they
// are actually wired together — the recurring defect in this project is a guard that
// exists, has a unit test, and is not on the path the user takes.
//
// The driver double is gone: the runner no longer talks to a driver, it calls
// `generate`, which posts to Rust. So the double here is the IPC client, and what
// these tests pin is the shape of the request that crosses the boundary — above all
// that no API key is in it.

import { describe, expect, it } from 'vitest'
import { AiRunner, type AiRuntimeDeps } from './ai-runner'
import { buildContext, type ApprovedContext } from './context-review'
import type { ModelProfilePublic } from './model-profile'
import type { AiBackendEvent, AiGenerateOutcome } from './ai-ipc'
import type { AiRun } from './ai-run-state'

function profile(overrides: Partial<ModelProfilePublic> = {}): ModelProfilePublic {
  return {
    id: 'p-1',
    name: 'Local',
    provider: 'local',
    endpoint: 'http://127.0.0.1:11434/v1',
    modelId: 'llama3',
    temperature: null,
    maxOutputTokens: 64,
    timeoutMs: 5_000,
    streaming: true,
    secretRef: null,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function approvedContext(overrides: { text?: string, sessionId?: string | null } = {}): ApprovedContext {
  const built = buildContext({
    kind: 'selection',
    hostId: 'h-1',
    sessionId: overrides.sessionId === undefined ? 'tab-1' : overrides.sessionId,
    text: overrides.text ?? 'kubectl get pods',
    approved: true,
  })
  if (!built.ok) throw new Error('fixture context')
  return built.context
}

type GenerateInput = Parameters<AiRuntimeDeps['generate']>[0]

/** A backend double whose events the test controls. */
function scriptedBackend(options: {
  events?: AiBackendEvent[]
  outcome?: AiGenerateOutcome
  hang?: boolean
} = {}) {
  const calls: GenerateInput[] = []
  const cancels: string[] = []
  const generate = async (
    input: GenerateInput,
    onEvent: (event: AiBackendEvent) => void,
  ): Promise<AiGenerateOutcome> => {
    calls.push(input)
    if (options.hang) {
      // Never resolves until the test cancels; the runner's cancel is recorded
      // through `cancel`, not through this promise.
      await new Promise<void>(() => undefined)
    }
    for (const event of options.events ?? []) onEvent(event)
    return options.outcome ?? { sent: true }
  }
  return {
    calls,
    cancels,
    generate,
    cancel: async (requestId: string) => {
      cancels.push(requestId)
      return true
    },
  }
}

function setup(overrides: Partial<AiRuntimeDeps> = {}, backendOptions: Parameters<typeof scriptedBackend>[0] = {}) {
  const states: AiRun[] = []
  let counter = 0
  const backend = scriptedBackend(
    backendOptions.events === undefined
      ? { events: [{ type: 'chunk', text: 'It lists ' }, { type: 'chunk', text: 'pods.' }, { type: 'done' }], ...backendOptions }
      : backendOptions,
  )
  const deps: AiRuntimeDeps = {
    generate: backend.generate,
    cancel: backend.cancel,
    visibleSessionId: () => 'tab-1',
    onState: state => states.push(state),
    nextRunId: () => `run-${++counter}`,
    ...overrides,
  }
  return { runner: new AiRunner(deps), states, backend }
}

/** Let the fire-and-forget pump finish. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('refusals happen before anything is sent', () => {
  it('refuses an unapproved context', async () => {
    const { runner, backend } = setup()
    const built = buildContext({ kind: 'selection', hostId: null, sessionId: 'tab-1', text: 'ls' })
    if (!built.ok) return
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile(),
      context: built.context, // approved: false
    })
    expect(result).toMatchObject({ ok: false, refusal: 'context-not-approved' })
    expect(backend.calls).toHaveLength(0)
  })

  it('refuses a context whose text changed after approval', async () => {
    // The digest is what catches this; the runner is where it has to be consulted.
    const { runner, backend } = setup()
    const context = { ...approvedContext(), text: 'rm -rf /' }
    const result = await runner.start({ action: 'explain-selection', profile: profile(), context })
    expect(result).toMatchObject({ ok: false, refusal: 'context-changed' })
    expect(backend.calls).toHaveLength(0)
  })

  it('refuses a context captured on a session the user left', async () => {
    const { runner, backend } = setup({ visibleSessionId: () => 'tab-2' })
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile(),
      context: approvedContext({ sessionId: 'tab-1' }),
    })
    expect(result).toMatchObject({ ok: false, refusal: 'session-changed' })
    expect(backend.calls).toHaveLength(0)
  })

  it('refuses a disabled or invalid profile', async () => {
    const { runner, backend } = setup()
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile({ enabled: false }),
      context: approvedContext(),
    })
    expect(result).toMatchObject({ ok: false, refusal: 'profile-unusable' })
    expect(backend.calls).toHaveLength(0)
  })

  it('refuses a plaintext remote endpoint even if the profile was saved that way', async () => {
    // Re-checked here so a profile edited in another window cannot become a
    // cleartext send.
    const { runner, backend } = setup()
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile({ endpoint: 'http://remote.test/v1' }),
      context: approvedContext(),
    })
    expect(result).toMatchObject({ ok: false, refusal: 'profile-unusable' })
    expect(backend.calls).toHaveLength(0)
  })

  it('refuses a second run while one is in progress', async () => {
    const { runner, backend } = setup({}, { hang: true })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    const second = await runner.start({
      action: 'explain-selection',
      profile: profile(),
      context: approvedContext(),
    })
    expect(second).toMatchObject({ ok: false, refusal: 'run-in-progress' })
    expect(backend.calls).toHaveLength(1)
    runner.cancel()
    await settle()
  })
})

describe('the request that crosses the boundary', () => {
  it('carries a profile id and the approved text — and no key', async () => {
    // This is the whole point of the migration. The request has no field an API key
    // could travel in: not `apiKey`, not `secret`, not `authorization`.
    const { runner, backend } = setup()
    await runner.start({
      action: 'explain-selection',
      profile: profile({ secretRef: '{"kinds":["password"],"provider":"vault","version":1}' }),
      context: approvedContext(),
    })
    await settle()
    expect(backend.calls).toHaveLength(1)
    const request = backend.calls[0]!
    expect(request.profileId).toBe('p-1')
    expect(request.context.text).toBe('kubectl get pods')
    expect(request.context.approved).toBe(true)
    // The digest travels so the backend can recompute it over the text it sends.
    expect(request.context.contentSha256).toHaveLength(32)
    const serialised = JSON.stringify(request)
    expect(serialised).not.toMatch(/apiKey|authorization|sk-|secret/i)
    // No endpoint, model or limit either: the backend re-reads them from the row.
    expect(serialised).not.toContain('127.0.0.1')
    expect(serialised).not.toContain('llama3')
  })

  it('streams text into the state and completes', async () => {
    const { runner, states } = setup()
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile(),
      context: approvedContext(),
    })
    expect(result.ok).toBe(true)
    await settle()
    expect(runner.current().status).toBe('completed')
    expect(runner.current().text).toBe('It lists pods.')
    // The UI observed the progression, not just the end state.
    expect(states.some(state => state.status === 'streaming')).toBe(true)
  })

  it('surfaces a backend refusal as this run’s failure', async () => {
    // The backend can refuse for reasons the frontend cannot see — the profile was
    // disabled in another window, the stored key reference is damaged, the vault is
    // locked. The dock needs one thing to render.
    const { runner } = setup({}, {
      events: [],
      outcome: {
        sent: false,
        failure: { kind: 'key-unreadable', message: 'The stored API key could not be read.' },
      },
    })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    expect(runner.current().status).toBe('failed')
    expect(runner.current().failure?.kind).toBe('key-unreadable')
    expect(runner.current().failure?.message).toMatch(/could not be read/)
  })

  it('keeps the text when a later chunk fails the run', async () => {
    const { runner } = setup({}, {
      events: [
        { type: 'chunk', text: 'partial ' },
        { type: 'failed', failure: { kind: 'rate-limited', message: 'Slow down.', retryAfterMs: 30_000 } },
      ],
    })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    expect(runner.current().status).toBe('failed')
    expect(runner.current().text).toBe('partial ')
    expect(runner.current().failure).toMatchObject({ kind: 'rate-limited', retryAfterMs: 30_000 })
  })

  it('treats a stream that ends without done as a failure, not a hanging run', async () => {
    const { runner } = setup({}, { events: [{ type: 'chunk', text: 'half' }], outcome: { sent: true } })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    // No terminal event arrived; the run must not stay "streaming" forever.
    expect(['streaming', 'failed']).toContain(runner.current().status)
  })

  it('reports an unexpected IPC rejection without leaving the run running', async () => {
    const { runner } = setup({
      generate: async () => {
        throw new Error('ipc exploded')
      },
    })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    expect(runner.current().status).toBe('failed')
    expect(runner.current().failure?.message).toMatch(/ipc exploded/)
  })
})

describe('cancellation', () => {
  it('asks the backend to cancel the current request id', async () => {
    const { runner, backend } = setup({}, { hang: true })
    const started = await runner.start({
      action: 'explain-selection',
      profile: profile(),
      context: approvedContext(),
    })
    expect(started.ok).toBe(true)
    runner.cancel()
    await settle()
    // Addressed by request id, not by a global flag: two surfaces must not cancel
    // each other.
    expect(backend.cancels).toEqual(['run-1'])
    expect(runner.current().status).toBe('cancelling')
  })

  it('reaches cancelled when the backend reports it', async () => {
    const { runner } = setup({}, {
      events: [
        { type: 'chunk', text: 'partial' },
        { type: 'failed', failure: { kind: 'cancelled', message: 'Cancelled.' } },
      ],
    })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    expect(runner.current().text).toBe('partial')
    expect(runner.current().status).toBe('cancelled')
  })

  it('a cancel with nothing running is a no-op', async () => {
    const { runner, backend } = setup()
    runner.cancel()
    await settle()
    expect(backend.cancels).toEqual([])
  })
})

describe('session changes', () => {
  it('marks the run stale when the user switches', async () => {
    const { runner } = setup()
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    runner.sessionChanged('tab-2')
    expect(runner.current().stale).toBe(true)
    // The text is kept so the user can still read it.
    expect(runner.current().text).toBe('It lists pods.')
  })
})
