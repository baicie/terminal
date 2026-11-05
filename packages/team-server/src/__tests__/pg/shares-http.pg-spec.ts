// P9.3.1 P0-2：Share REST 的 JSON 版本契约。
//
// 独立审查发现 `SharesService.findOne()` 直接返回 Prisma 对象，而 Prisma 的
// `Share.version` 是 BigInt。Node 原生 `JSON.stringify` 不能序列化 bigint：
//
//   TypeError: Do not know how to serialize a BigInt
//
// 于是 `GET /teams/:teamId/shares/:shareId` 会 500。直接调用 SharesService
// 永远看不到这一步——它返回的是对象，不是字节。
//
// 本文件用真实 controller 实例 + Node 内置 http server + 真实 `fetch`，连真实
// PostgreSQL。刻意不用 `Test.createTestingModule`（会拉起整个 DI 图，与本契约
// 无关且在本仓库的 fork worker 里启动超时），也不用 express（它不是
// team-server 的直接依赖）。

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PrismaService } from '../../prisma.service'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SharesController } from '../../shares/shares.controller'
import { SharesService } from '../../shares/shares.service'
import { createPrisma, resetDatabase, seedTeams } from './pg-harness'

/**
 * Mirrors what Nest's `ExpressAdapter` does with a controller return value: hand
 * it to `res.json()`, i.e. `JSON.stringify`. A BigInt reaching this point throws
 * exactly as it would in production.
 */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  let payload: string
  try {
    payload = JSON.stringify(value)
  } catch (error) {
    // This is the production failure: Nest's exception filter answers 500 when
    // the adapter cannot serialise the handler's return value.
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ statusCode: 500, message: (error as Error).message }))
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text === '') {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

type Route =
  | { kind: 'list', teamId: string }
  | { kind: 'one' | 'update', teamId: string, shareId: string }

function matchRoute(method: string, pathname: string): Route | null {
  const list = /^\/api\/v1\/teams\/([^/]+)\/shares$/.exec(pathname)
  const one = /^\/api\/v1\/teams\/([^/]+)\/shares\/([^/]+)$/.exec(pathname)
  if (method === 'GET' && list !== null) return { kind: 'list', teamId: list[1] }
  if (method === 'GET' && one !== null) return { kind: 'one', teamId: one[1], shareId: one[2] }
  if (method === 'PUT' && one !== null) return { kind: 'update', teamId: one[1], shareId: one[2] }
  return null
}

describe('Share REST 的 JSON 版本契约（真实 PostgreSQL + 真实 HTTP）', () => {
  let prisma: PrismaService
  let controller: SharesController
  let baseUrl: string
  let server: ReturnType<typeof createServer>
  let teamId: string
  let ownerId: string
  const shareId = 'http-share-1'

  beforeAll(async () => {
    prisma = createPrisma()
    controller = new SharesController(new SharesService(prisma))
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const route = matchRoute(req.method ?? 'GET', url.pathname)
        if (route === null) {
          sendJson(res, 404, { statusCode: 404, message: `Cannot ${req.method} ${url.pathname}` })
          return
        }
        // Authentication itself is covered by api-key.guard.test.ts; here the
        // caller is fixed so the contract under test is only the JSON shape.
        const userId = ownerId
        if (route.kind === 'list') {
          sendJson(res, 200, await controller.findAll(route.teamId, userId))
          return
        }
        if (route.kind === 'one') {
          sendJson(res, 200, await controller.findOne(route.teamId, route.shareId, userId))
          return
        }
        // The controller takes (teamId, shareId, body, userId) -- body before
        // the authenticated caller.
        sendJson(res, 200, await controller.update(
          route.teamId,
          route.shareId,
          await readBody(req) as never,
          userId,
        ))
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500
        sendJson(res, status, { statusCode: status, message: (error as Error).message })
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()))
    await prisma?.onModuleDestroy()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    const ctx = await seedTeams(prisma)
    teamId = ctx.teamId
    ownerId = ctx.creatorId
    // Seeded with raw SQL rather than the service: the point of this file is
    // the serialiser, and a service call here would open a second pool against
    // the same database for no added coverage. The trigger that assigns
    // `version` runs on this INSERT exactly as it does on a real create.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Share" (id, "teamId", type, data, permission, "sharedBy", "isSensitive", "encryptedData", "createdAt", "updatedAt")
       VALUES ($1, $2, 'HOST', $3::jsonb, 'READWRITE', $4, false, NULL, now(), now())`,
      shareId,
      teamId,
      JSON.stringify({ name: 'web-1' }),
      ownerId,
    )
  })

  const headers = { 'Content-Type': 'application/json' }

  it('serialises a share whose version is a BigInt', async () => {
    const response = await fetch(`${baseUrl}/teams/${teamId}/shares/${shareId}`, { headers })
    const text = await response.text()
    // The regression this file exists for: a 500 here is bigint escaping into
    // JSON.stringify, not an auth or routing problem.
    expect(response.status, `GET single failed: ${text.slice(0, 300)}`).toBe(200)

    const body = JSON.parse(text) as Record<string, unknown>
    expect(typeof body.version, 'version must be a JSON number').toBe('number')
    expect(Number.isSafeInteger(body.version as number)).toBe(true)
    expect(body.id).toBe(shareId)
    expect(body.teamId).toBe(teamId)
  })

  it('serialises the list endpoint the same way', async () => {
    const response = await fetch(`${baseUrl}/teams/${teamId}/shares`, { headers })
    const text = await response.text()
    expect(response.status, `GET list failed: ${text.slice(0, 300)}`).toBe(200)
    const rows = JSON.parse(text) as Array<Record<string, unknown>>
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(typeof row.version).toBe('number')
      expect(Number.isSafeInteger(row.version as number)).toBe(true)
    }
  })

  it('serialises an updated share', async () => {
    const current = await prisma.share.findUniqueOrThrow({
      where: { id: shareId },
    })
    const response = await fetch(`${baseUrl}/teams/${teamId}/shares/${shareId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        baseVersion: Number(current.version),
        data: { name: 'web-2' },
      }),
    })
    const text = await response.text()
    expect(response.status, `PUT failed: ${text.slice(0, 1200)}`).toBe(200)
    const body = JSON.parse(text) as Record<string, unknown>
    expect(typeof body.version).toBe('number')
  })

  it('keeps a missing share a 404 rather than a serialisation failure', async () => {
    const response = await fetch(`${baseUrl}/teams/${teamId}/shares/does-not-exist`, { headers })
    expect(response.status).toBe(404)
  })
})
