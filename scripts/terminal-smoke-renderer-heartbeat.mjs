import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const LOOPBACK = '127.0.0.1'
const MAX_BODY_BYTES = 2_048
const CLOSE_TIMEOUT_MS = 1_000
const HEARTBEAT_PATH = '/heartbeat'

function send(response, status) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST',
    connection: 'close',
  })
  response.end()
}

function tokenMatches(candidate, token) {
  if (typeof candidate !== 'string' || !/^[a-f0-9]{64}$/.test(candidate)) return false
  return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(token, 'hex'))
}

function validHeartbeat(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Number.isSafeInteger(value.seq) &&
    value.seq > 0 &&
    typeof value.performanceNow === 'number' &&
    Number.isFinite(value.performanceNow) &&
    ['visible', 'hidden'].includes(value.visibilityState) &&
    typeof value.hasFocus === 'boolean' &&
    typeof value.online === 'boolean'
  )
}

function readBody(request) {
  return new Promise(resolve => {
    const declaredLength = Number(request.headers['content-length'])
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      resolve({ tooLarge: true })
      return
    }

    const chunks = []
    let size = 0
    let tooLarge = false
    request.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        request.pause()
        resolve({ tooLarge: true })
      } else if (!tooLarge) {
        chunks.push(chunk)
      }
    })
    request.on('end', () =>
      resolve({ tooLarge, body: tooLarge ? '' : Buffer.concat(chunks).toString('utf8') }),
    )
    request.on('error', () => resolve({ tooLarge: false, body: '' }))
  })
}

function waitUntilListening(server, listen) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string' || address.address !== LOOPBACK) {
        server.close()
        reject(new Error('renderer heartbeat listener must bind to 127.0.0.1'))
      } else {
        resolve(address.port)
      }
    }
    server.once('error', onError)
    server.once('listening', onListening)
    try {
      listen(server, Object.freeze({ host: LOOPBACK, port: 0, exclusive: true }))
    } catch (error) {
      server.removeListener('error', onError)
      server.removeListener('listening', onListening)
      reject(error)
    }
  })
}

export async function startTerminalSmokeRendererHeartbeat({ directory, listen } = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new TypeError('directory must be a non-empty path')
  }

  await mkdir(directory, { recursive: true })
  const token = randomBytes(32).toString('hex')
  const startedAt = performance.now()
  const outputPath = path.join(directory, 'renderer-heartbeat.ndjson')
  const server = createServer(async (request, response) => {
    let url
    try {
      url = new URL(request.url, `http://${LOOPBACK}`)
    } catch {
      send(response, 400)
      return
    }

    if (url.pathname !== HEARTBEAT_PATH) {
      send(response, 404)
      return
    }
    if (request.method !== 'POST') {
      send(response, 405)
      return
    }
    const tokens = url.searchParams.getAll('token')
    if (tokens.length !== 1 || !tokenMatches(tokens[0], token)) {
      send(response, 401)
      return
    }
    if (
      (request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !==
      'text/plain'
    ) {
      send(response, 415)
      return
    }

    const { body, tooLarge } = await readBody(request)
    if (tooLarge) {
      send(response, 413)
      return
    }

    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      send(response, 400)
      return
    }
    if (!validHeartbeat(payload)) {
      send(response, 400)
      return
    }

    try {
      await appendFile(
        outputPath,
        `${JSON.stringify({
          ...payload,
          receivedElapsedMs: Math.round(performance.now() - startedAt),
        })}\n`,
        { encoding: 'utf8' },
      )
    } catch {
      send(response, 500)
      return
    }
    send(response, 204)
  })

  const port = await waitUntilListening(
    server,
    listen ?? ((instance, options) => instance.listen(options)),
  )
  let closePromise
  return {
    endpoint: `http://${LOOPBACK}:${port}${HEARTBEAT_PATH}`,
    token,
    close() {
      if (closePromise) return closePromise
      closePromise = new Promise(resolve => {
        const timeout = setTimeout(() => {
          server.closeAllConnections?.()
          resolve()
        }, CLOSE_TIMEOUT_MS)
        server.close(() => {
          clearTimeout(timeout)
          resolve()
        })
        server.closeAllConnections?.()
      })
      return closePromise
    },
  }
}
