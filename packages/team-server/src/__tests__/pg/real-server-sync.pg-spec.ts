// Real Nest HTTP sync E2E: full AppModule, real ApiKeyGuard, real ValidationPipe,
// real PostgreSQL and real fetch. The only pre-seeded state is the two users'
// registration; teams/members/shares are created through HTTP.
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { PrismaService } from '../../prisma.service'
import { resetDatabase, resolveTestDatabaseUrl } from './pg-harness'

process.env.DATABASE_URL = resolveTestDatabaseUrl()
process.env.NODE_ENV = 'test'
process.env.REGISTRATION_MODE = 'open'

describe('real Nest HTTP sync', () => {
  let app: INestApplication
  let prisma: PrismaService
  let base: string
  let tokenA: string
  let tokenB: string
  let userIdA: string
  let userIdB: string
  let teamId: string

  async function call(method: string, path: string, token: string | null, body?: unknown) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json: unknown = null
    try { json = text.length === 0 ? null : JSON.parse(text) } catch { json = text }
    return { status: response.status, json }
  }

  async function register(userId: string) {
    const result = await call('POST', '/api/v1/auth/register', null, { userId })
    expect(result.status).toBe(201)
    const payload = result.json as { userId: string, token: string }
    expect(payload.userId).toBe(userId)
    expect(typeof payload.token).toBe('string')
    return payload
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    base = `http://127.0.0.1:${address.port}`
    prisma = app.get(PrismaService)
    await resetDatabase(prisma)
    const a = await register('http-e2e-user-a')
    const b = await register('http-e2e-user-b')
    tokenA = a.token
    tokenB = b.token
    userIdA = a.userId
    userIdB = b.userId
  }, 60_000)

  afterAll(async () => {
    await app?.close()
  })

  it('creates a team over HTTP without BigInt serialization failures', async () => {
    const created = await call('POST', '/api/v1/teams', tokenA, { name: 'HTTP E2E Team' })
    expect(created.status).toBe(201)
    const team = created.json as { id: string, members: Array<{ userId: string, joinedTxid: string }> }
    expect(team.id).toBeTruthy()
    expect(team.members[0].userId).toBe(userIdA)
    expect(typeof team.members[0].joinedTxid).toBe('string')
    teamId = team.id

    const added = await call('POST', `/api/v1/teams/${teamId}/members`, tokenA, {
      userId: userIdB,
      role: 'MEMBER',
    })
    expect(added.status).toBe(201)
    expect((added.json as { joinedTxid: string }).joinedTxid).toBeTypeOf('string')
  })

  it('pushes and pulls a share through the authenticated HTTP stack', async () => {
    const share = {
      id: 'http-share-1',
      teamId,
      type: 'HOST',
      data: { name: 'http-e2e-host' },
      permission: 'READWRITE',
      operation: 'CREATE',
    }
    const pushed = await call('POST', '/api/v1/sync', tokenA, { shares: [share] })
    expect(pushed.status).toBe(201)
    expect((pushed.json as { created: string[] }).created).toContain(share.id)

    const pulledB = await call('GET', `/api/v1/sync?since=0`, tokenB)
    expect(pulledB.status).toBe(200)
    const shares = (pulledB.json as { shares: Array<{ id: string, data: unknown, version: number | string }> }).shares
    const pulledShare = shares.find(item => item.id === share.id)
    expect(pulledShare).toBeDefined()

    const updated = {
      ...share,
      data: { name: 'http-e2e-host-updated' },
      operation: 'UPDATE',
      baseVersion: Number(pulledShare?.version),
    }
    const pushedUpdate = await call('POST', '/api/v1/sync', tokenB, { shares: [updated] })
    expect(pushedUpdate.status).toBe(201)
    expect(pushedUpdate.json).toMatchObject({ updated: [share.id] })
    const pulledA = await call('GET', `/api/v1/sync?since=0`, tokenA)
    const updatedShare = (pulledA.json as { shares: Array<{ id: string, data: { name: string } }> })
      .shares.find(item => item.id === share.id)
    expect(updatedShare?.data.name).toBe('http-e2e-host-updated')
  })

  it('refuses a retired timestamp cursor with 426 and changes nothing', async () => {
    const before = await call('GET', '/api/v1/sync?since=0', tokenA)
    const refused = await call(
      'GET',
      `/api/v1/sync?since=${Date.now()}`,
      tokenA,
    )
    expect(refused.status).toBe(426)
    expect(refused.json).toMatchObject({
      code: 'CLIENT_UPGRADE_REQUIRED',
      requiredCursorVersion: 2,
    })
    const after = await call('GET', '/api/v1/sync?since=0', tokenA)
    const ids = (result: { json: unknown }) =>
      (result.json as { shares: Array<{ id: string }> }).shares
        .map(share => share.id)
        .sort()
    expect(ids(after)).toEqual(ids(before))
  })
})
