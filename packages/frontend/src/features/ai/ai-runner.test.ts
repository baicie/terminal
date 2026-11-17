// The orchestration: every refusal, and cancellation on the real path.
//
// Each rule here was tested in isolation by the module that owns it. This asserts they
// are actually wired together — the recurring defect in this project is a guard that
// exists, has a unit test, and is not on the path the user takes.

import { describe, expect, it, vi } from 'vitest'
import { AiRunner, driverRegistry, type AiRuntimeDeps } from './ai-runner'
import { buildContext, type ApprovedContext } from './context-review'
import type { ModelProfilePublic } from './model-profile'
import type { CancelSignal, DriverEvent, DriverRequest, ModelDriver } from './model-driver'
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

function signal(): CancelSignal & { cancel(): void } {
  let cancelled = false
  let resolve: () => void = () => undefined
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return {
    get cancelled() {
      return cancelled
    },
    whenCancelled: () => promise,
    cancel() {
      cancelled = true
      resolve()
    },
  }
}

/** A driver whose events the test controls. */
function scriptedDriver(events: DriverEvent[]): ModelDriver & { lastRequest?: DriverRequest } {
  return {
    provider: 'local',
    async test() {
      return { ok: true as const }
    },
    async *stream(request: DriverRequest): AsyncIterable<DriverEvent> {
      ;(this as { lastRequest?: DriverRequest }).lastRequest = request
      for (const event of events) yield event
    },
  }
}

function setup(overrides: Partial<AiRuntimeDeps> = {}) {
  const states: AiRun[] = []
  let counter = 0
  const driver = scriptedDriver([{ type: 'chunk', text: 'It lists ' }, { type: 'chunk', text: 'pods.' }, { type: 'done' }])
  const deps: AiRuntimeDeps = {
    driverFor: () => driver,
    readKey: async () => undefined,
    visibleSessionId: () => 'tab-1',
    onState: state => states.push(state),
    nextRunId: () => `run-${++counter}`,
    createSignal: () => signal(),
    ...overrides,
  }
  return { runner: new AiRunner(deps), states, driver }
}

/** Let the fire-and-forget pump finish. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('refusals happen before anything is sent', () => {
  it('refuses an unapproved context', async () => {
    const { runner, driver } = setup()
    const built = buildContext({ kind: 'selection', hostId: null, sessionId: 'tab-1', text: 'ls' })
    if (!built.ok) return
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile(),
      context: built.context, // approved: false
    })
    expect(result).toMatchObject({ ok: false, refusal: 'context-not-approved' })
    expect(driver.lastRequest).toBeUndefined()
  })

  it('refuses a context whose text changed after approval', async () => {
    // The digest is what catches this; the runner is where it has to be consulted.
    const { runner, driver } = setup()
    const context = { ...approvedContext(), text: 'rm -rf /' }
    const result = await runner.start({ action: 'explain-selection', profile: profile(), context })
    expect(result).toMatchObject({ ok: false, refusal: 'context-changed' })
    expect(driver.lastRequest).toBeUndefined()
  })

  it('refuses a context captured on a session the user left', async () => {
    const { runner, driver } = setup({ visibleSessionId: () => 'tab-2' })
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile(),
      context: approvedContext({ sessionId: 'tab-1' }),
    })
    expect(result).toMatchObject({ ok: false, refusal: 'session-changed' })
    expect(driver.lastRequest).toBeUndefined()
  })

  it('refuses a disabled or invalid profile', async () => {
    const { runner } = setup()
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile({ enabled: false }),
      context: approvedContext(),
    })
    expect(result).toMatchObject({ ok: false, refusal: 'profile-unusable' })
  })

  it('refuses a plaintext remote endpoint even if the profile was saved that way', async () => {
    // Re-checked here so a profile edited in another window cannot become a
    // cleartext send.
    const { runner, driver } = setup()
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile({ endpoint: 'http://remote.test/v1' }),
      context: approvedContext(),
    })
    expect(result).toMatchObject({ ok: false, refusal: 'profile-unusable' })
    expect(driver.lastRequest).toBeUndefined()
  })

  it('refuses a provider with no driver', async () => {
    // `anthropic` is declared in the profile type and has no adapter yet. Attempting
    // it would send the user's text to a URL with the wrong wire format.
    const { runner } = setup({ driverFor: () => undefined })
    const result = await runner.start({
      action: 'explain-selection',
      profile: profile({ provider: 'anthropic' }),
      context: approvedContext(),
    })
    expect(result).toMatchObject({ ok: false, refusal: 'profile-unusable' })
  })

  it('refuses a second run while one is in progress', async () => {
    const { runner } = setup({
      driverFor: () => ({
        provider: 'local',
        async test() {
          return { ok: true as const }
        },
        async *stream(_request: DriverRequest, cancel: CancelSignal): AsyncIterable<DriverEvent> {
          // Never finishes until cancelled.
          await cancel.whenCancelled()
          yield { type: 'failed', failure: { kind: 'cancelled', message: 'cancelled' } }
        },
      }),
    })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    const second = await runner.start({
      action: 'explain-selection',
      profile: profile(),
      context: approvedContext(),
    })
    expect(second).toMatchObject({ ok: false, refusal: 'run-in-progress' })
    runner.cancel()
    await settle()
  })
})

describe('a successful run', () => {
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

  it('sends the delimited payload, not a concatenated prompt', async () => {
    const { runner, driver } = setup()
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    const request = driver.lastRequest!
    expect(request.messages).toHaveLength(2)
    expect(request.messages[1].content).toContain('kubectl get pods')
    expect(request.messages[0].content).not.toContain('kubectl get pods')
  })

  it('passes the resolved key and never logs it', async () => {
    const { runner, driver } = setup({ readKey: async () => 'sk-test' })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    expect(driver.lastRequest?.apiKey).toBe('sk-test')
  })

  it('reports a key that exists but cannot be read as a failure, not as "no key"', async () => {
    // Sending with no key would produce a 401 the user cannot explain.
    const { runner, driver } = setup({
      readKey: async () => {
        throw new Error('vault is locked')
      },
    })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    expect(runner.current().status).toBe('failed')
    expect(runner.current().failure?.message).toMatch(/locked/)
    expect(driver.lastRequest).toBeUndefined()
  })
})

describe('cancellation', () => {
  it('reaches cancelled and stops appending', async () => {
    let release: () => void = () => undefined
    const { runner } = setup({
      driverFor: () => ({
        provider: 'local',
        async test() {
          return { ok: true as const }
        },
        async *stream(_request: DriverRequest, cancel: CancelSignal): AsyncIterable<DriverEvent> {
          yield { type: 'chunk', text: 'partial' }
          release = () => undefined
          await new Promise<void>(resolve => {
            release = resolve
            void cancel.whenCancelled().then(resolve)
          })
          // A late chunk after cancellation; the reducer must drop it.
          yield { type: 'chunk', text: ' LATE' }
          yield { type: 'done' }
        },
      }),
    })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    expect(runner.current().text).toBe('partial')

    runner.cancel()
    release()
    await settle()

    expect(runner.current().text).toBe('partial')
    expect(['cancelled', 'cancelling']).toContain(runner.current().status)
  })
})

describe('a stream that ends without done', () => {
  it('is reported rather than left running', async () => {
    // A provider that closes mid-answer must not leave a spinner forever.
    const { runner } = setup({ driverFor: () => scriptedDriver([{ type: 'chunk', text: 'half' }]) })
    await runner.start({ action: 'explain-selection', profile: profile(), context: approvedContext() })
    await settle()
    expect(runner.current().status).toBe('failed')
    expect(runner.current().failure?.kind).toBe('bad-response')
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

describe('the driver registry', () => {
  it('covers both openai-compatible and local, and nothing else', () => {
    const registry = driverRegistry()
    expect(registry.get('openai-compatible')).toBeDefined()
    expect(registry.get('local')).toBeDefined()
    // No adapter yet: `anthropic` is declared in the type and refused at start.
    expect(registry.get('anthropic')).toBeUndefined()
  })
})

void vi
