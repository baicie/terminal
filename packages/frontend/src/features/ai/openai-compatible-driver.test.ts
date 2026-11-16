// The HTTP adapter, tested against a real fake server.
//
// The design asks for exactly this: a local fake HTTP server covering every status,
// with the driver's own behaviour asserted rather than a mock's convenience. `fetch`
// is real, the server is real, and only the network's far end is ours.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  OpenAiCompatibleDriver,
  buildRequestBody,
  chatCompletionsUrl,
  chunkText,
  fullText,
  parseSseLine,
} from './openai-compatible-driver'
import type { CancelSignal, DriverRequest } from './model-driver'
import { buildContext } from './context-review'

/** A cancel signal a test can trip. */
function cancelSignal(): CancelSignal & { cancel(): void } {
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

function request(overrides: Partial<DriverRequest> = {}): DriverRequest {
  const built = buildContext({
    kind: 'selection',
    hostId: 'h-1',
    sessionId: 'tab-1',
    text: 'kubectl get pods',
    approved: true,
  })
  if (!built.ok) throw new Error('fixture context')
  return {
    requestId: 'req-1',
    profileId: 'p-1',
    endpoint: '',
    modelId: 'test-model',
    temperature: null,
    maxOutputTokens: 64,
    timeoutMs: 5_000,
    streaming: false,
    apiKey: 'sk-test-key',
    action: 'explain-selection',
    context: built.context,
    messages: [
      { role: 'system', content: 'explain' },
      { role: 'user', content: 'kubectl get pods' },
    ],
    ...overrides,
  }
}

let server: Server | null = null
let baseUrl = ''
let lastRequest: { headers: Record<string, unknown>; body: string } | null = null

/** Start a server that answers with whatever the test installed. */
async function serve(
  handler: (req: { headers: Record<string, unknown>; body: string }, res: ServerResponse) => void,
): Promise<void> {
  lastRequest = null
  server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      lastRequest = { headers: req.headers as Record<string, unknown>, body }
      handler({ headers: req.headers as Record<string, unknown>, body }, res)
    })
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server!.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}/v1`
}

afterEach(async () => {
  if (server) {
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = null
  }
})

describe('URL and body construction', () => {
  it('appends the chat path to a base endpoint', () => {
    expect(chatCompletionsUrl('https://x.test/v1')).toBe('https://x.test/v1/chat/completions')
    expect(chatCompletionsUrl('https://x.test/v1/')).toBe('https://x.test/v1/chat/completions')
  })

  it('respects an endpoint that already names the path', () => {
    expect(chatCompletionsUrl('https://x.test/v1/chat/completions')).toBe(
      'https://x.test/v1/chat/completions',
    )
  })

  it('omits temperature when unset rather than defaulting it', () => {
    expect(buildRequestBody(request({ temperature: null }))).not.toHaveProperty('temperature')
    expect(buildRequestBody(request({ temperature: 0 }))).toHaveProperty('temperature', 0)
  })
})

describe('SSE parsing', () => {
  it('reads data lines and ignores everything else', () => {
    expect(parseSseLine('data: {"a":1}')).toEqual({ kind: 'data', json: '{"a":1}' })
    expect(parseSseLine(': keep-alive')).toBeNull()
    expect(parseSseLine('')).toBeNull()
    expect(parseSseLine('event: ping')).toBeNull()
  })

  it('treats [DONE] as a terminator', () => {
    expect(parseSseLine('data: [DONE]')).toEqual({ kind: 'done' })
  })

  it('reads content from a delta and from a whole message', () => {
    expect(chunkText({ choices: [{ delta: { content: 'hi' } }] })).toBe('hi')
    expect(chunkText({ choices: [{ delta: {} }] })).toBeNull()
    expect(fullText({ choices: [{ message: { content: 'whole' } }] })).toBe('whole')
  })
})

describe('non-streaming request', () => {
  it('sends the key, the model and the messages', async () => {
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'It lists pods.' } }] }))
    })
    const driver = new OpenAiCompatibleDriver()
    const events: string[] = []
    for await (const event of driver.stream(request({ endpoint: baseUrl }), cancelSignal())) {
      if (event.type === 'chunk') events.push(event.text)
      if (event.type === 'done') events.push('DONE')
    }
    expect(events).toEqual(['It lists pods.', 'DONE'])
    expect(lastRequest?.headers.authorization).toBe('Bearer sk-test-key')
    expect(JSON.parse(lastRequest!.body)).toMatchObject({ model: 'test-model', stream: false })
  })
})

describe('streaming request', () => {
  it('assembles chunks and stops at [DONE]', async () => {
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"It "}}]}\n\n')
      res.write(': keep-alive\n\n')
      res.write('data: {"choices":[{"delta":{"content":"lists pods."}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
    const driver = new OpenAiCompatibleDriver()
    let text = ''
    for await (const event of driver.stream(
      request({ endpoint: baseUrl, streaming: true }),
      cancelSignal(),
    )) {
      if (event.type === 'chunk') text += event.text
    }
    expect(text).toBe('It lists pods.')
  })

  it('skips an unparseable line without losing the rest', async () => {
    // A keep-alive or a malformed delta mid-stream must not discard an answer that
    // already arrived.
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"first "}}]}\n\n')
      res.write('data: {not json}\n\n')
      res.write('data: {"choices":[{"delta":{"content":"second"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
    const driver = new OpenAiCompatibleDriver()
    let text = ''
    for await (const event of driver.stream(
      request({ endpoint: baseUrl, streaming: true }),
      cancelSignal(),
    )) {
      if (event.type === 'chunk') text += event.text
    }
    expect(text).toBe('first second')
  })

  it('stops reading when cancelled', async () => {
    // The server keeps the stream open; the driver must stop rather than drain it.
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
      // Deliberately never ends.
    })
    const driver = new OpenAiCompatibleDriver()
    const signal = cancelSignal()
    let text = ''
    let failed = ''
    // Cancel after the first chunk arrives.
    const consume = (async () => {
      for await (const event of driver.stream(
        request({ endpoint: baseUrl, streaming: true }),
        signal,
      )) {
        if (event.type === 'chunk') {
          text += event.text
          signal.cancel()
        }
        if (event.type === 'failed') failed = event.failure.kind
      }
    })()
    await Promise.race([consume, new Promise(resolve => setTimeout(resolve, 3_000))])
    expect(text).toBe('partial')
    expect(failed).toBe('cancelled')
  }, 10_000)
})

describe('failure mapping', () => {
  const cases: Array<[number, string]> = [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
    [500, 'offline'],
    [503, 'offline'],
    [400, 'bad-response'],
  ]

  for (const [status, kind] of cases) {
    it(`maps ${status} to ${kind}`, async () => {
      await serve((_req, res) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'provider detail that must not leak' } }))
      })
      const driver = new OpenAiCompatibleDriver()
      let failure: { kind: string; message: string } | null = null
      for await (const event of driver.stream(request({ endpoint: baseUrl }), cancelSignal())) {
        if (event.type === 'failed') failure = event.failure
      }
      expect(failure?.kind).toBe(kind)
      // The provider's body never reaches the message: it can echo the request, and
      // the request carries the user's terminal text.
      expect(failure?.message).not.toMatch(/provider detail/)
      expect(failure?.message).not.toMatch(/sk-test-key/)
    })
  }

  it('carries Retry-After into the failure', async () => {
    await serve((_req, res) => {
      res.writeHead(429, { 'retry-after': '7' })
      res.end()
    })
    const driver = new OpenAiCompatibleDriver()
    let failure: { retryAfterMs?: number } | null = null
    for await (const event of driver.stream(request({ endpoint: baseUrl }), cancelSignal())) {
      if (event.type === 'failed') failure = event.failure
    }
    expect(failure?.retryAfterMs).toBe(7_000)
  })

  it('reports a timeout rather than hanging', async () => {
    await serve(() => {
      // Never responds.
    })
    const driver = new OpenAiCompatibleDriver()
    let failure: { kind: string } | null = null
    for await (const event of driver.stream(
      request({ endpoint: baseUrl, timeoutMs: 150 }),
      cancelSignal(),
    )) {
      if (event.type === 'failed') failure = event.failure
    }
    expect(failure?.kind).toBe('timeout')
  }, 10_000)

  it('reports offline for an unreachable host', async () => {
    const driver = new OpenAiCompatibleDriver()
    let failure: { kind: string } | null = null
    for await (const event of driver.stream(
      // A port nothing listens on.
      request({ endpoint: 'http://127.0.0.1:1/v1', timeoutMs: 2_000 }),
      cancelSignal(),
    )) {
      if (event.type === 'failed') failure = event.failure
    }
    expect(failure?.kind).toBe('offline')
  }, 10_000)

  it('reports bad-response for a body with no content', async () => {
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [] }))
    })
    const driver = new OpenAiCompatibleDriver()
    let failure: { kind: string } | null = null
    for await (const event of driver.stream(request({ endpoint: baseUrl }), cancelSignal())) {
      if (event.type === 'failed') failure = event.failure
    }
    expect(failure?.kind).toBe('bad-response')
  })

  it('reports bad-response for an empty stream that never produced content', async () => {
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end()
    })
    const driver = new OpenAiCompatibleDriver()
    let failure: { kind: string } | null = null
    for await (const event of driver.stream(
      request({ endpoint: baseUrl, streaming: true }),
      cancelSignal(),
    )) {
      if (event.type === 'failed') failure = event.failure
    }
    expect(failure?.kind).toBe('bad-response')
  })
})

describe('connection test', () => {
  it('sends no terminal context', async () => {
    // A reachability check must not move the user's text anywhere.
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })
    const driver = new OpenAiCompatibleDriver()
    const result = await driver.test(request({ endpoint: baseUrl }), cancelSignal())
    expect(result).toEqual({ ok: true })
    expect(lastRequest?.body).not.toContain('kubectl get pods')
    expect(lastRequest?.body).toContain('ping')
    expect(JSON.parse(lastRequest!.body)).toMatchObject({ max_tokens: 1, stream: false })
  })

  it('reports the failure kind on a bad key', async () => {
    await serve((_req, res) => {
      res.writeHead(401)
      res.end()
    })
    const driver = new OpenAiCompatibleDriver()
    const result = await driver.test(request({ endpoint: baseUrl }), cancelSignal())
    expect(result).toMatchObject({ ok: false, failure: { kind: 'unauthorized' } })
  })
})

describe('no key configured', () => {
  it('sends no authorization header rather than an empty bearer', async () => {
    // A local model server usually has no key. `Bearer ` with nothing after it is a
    // malformed header some servers reject.
    await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })
    const driver = new OpenAiCompatibleDriver()
    const events = []
    for await (const event of driver.stream(
      request({ endpoint: baseUrl, apiKey: null }),
      cancelSignal(),
    )) {
      events.push(event.type)
    }
    expect(lastRequest?.headers.authorization).toBeUndefined()
  })
})

void beforeEach
