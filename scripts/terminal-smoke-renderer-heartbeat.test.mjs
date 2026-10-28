import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { startTerminalSmokeRendererHeartbeat } from './terminal-smoke-renderer-heartbeat.mjs'

async function withHeartbeat(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'terminal-renderer-heartbeat-'))
  const heartbeat = await startTerminalSmokeRendererHeartbeat({ directory })
  try {
    await run(heartbeat, directory)
  } finally {
    await heartbeat.close()
    await rm(directory, { recursive: true, force: true })
  }
}

test('accepts a valid renderer heartbeat and appends NDJSON', async () => {
  await withHeartbeat(async ({ endpoint, token }, directory) => {
    assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+\/heartbeat$/)
    assert.match(token, /^[a-f0-9]{64}$/)
    const payload = {
      seq: 7,
      performanceNow: 123.5,
      visibilityState: 'visible',
      hasFocus: true,
      online: true,
    }
    const response = await fetch(`${endpoint}?token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: JSON.stringify(payload),
    })

    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    const { receivedElapsedMs, ...received } = JSON.parse(
      (await readFile(path.join(directory, 'renderer-heartbeat.ndjson'), 'utf8')).trim(),
    )
    assert.deepEqual(received, payload)
    assert.equal(Number.isSafeInteger(receivedElapsedMs), true)
    assert.ok(receivedElapsedMs >= 0)
  })
})

test('rejects invalid token, method, content type, body, and oversized payload', async () => {
  await withHeartbeat(async ({ endpoint, token }, directory) => {
    const cases = [
      {
        name: 'token',
        requestUrl: `${endpoint}?token=wrong`,
        init: { method: 'POST', body: '{}' },
        status: 401,
      },
      { name: 'method', init: { method: 'GET' }, status: 405 },
      {
        name: 'content type',
        init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        status: 415,
      },
      ...[
        { seq: 0, performanceNow: 12, visibilityState: 'visible', hasFocus: true, online: true },
        { seq: 1, performanceNow: 12, visibilityState: 'prerender', hasFocus: true, online: true },
        { seq: 1, performanceNow: 12, visibilityState: 'hidden', hasFocus: 1, online: true },
      ].map(payload => ({
        name: 'fields',
        init: {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: JSON.stringify(payload),
        },
        status: 400,
      })),
      {
        name: 'size',
        init: {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: 'x'.repeat(2049),
        },
        status: 413,
      },
    ]

    for (const item of cases) {
      const response = await fetch(item.requestUrl ?? `${endpoint}?token=${token}`, item.init)
      assert.equal(response.status, item.status, item.name)
    }

    await assert.rejects(
      readFile(path.join(directory, 'renderer-heartbeat.ndjson'), 'utf8'),
      error => error.code === 'ENOENT',
    )
  })
})

test('close is idempotent and stops accepting requests', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'terminal-renderer-heartbeat-'))
  const heartbeat = await startTerminalSmokeRendererHeartbeat({ directory })
  await heartbeat.close()
  await heartbeat.close()

  await assert.rejects(
    fetch(`${heartbeat.endpoint}?token=${heartbeat.token}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({
        seq: 1,
        performanceNow: 1,
        visibilityState: 'hidden',
        hasFocus: false,
        online: false,
      }),
    }),
  )
  await rm(directory, { recursive: true, force: true })
})
