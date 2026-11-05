// P9.3.2 A2：Share REST 的乐观并发契约，走真实 Nest HTTP 栈。
//
// 与 shares-http.pg-spec.ts 不同，这里不手工转发 Controller：Nest 的
// ExpressAdapter、ValidationPipe、全局前缀、ApiKeyGuard 和 DTO 校验全部真实
// 参与。测试要证明的是“客户端 A 用旧版本覆盖客户端 B 已提交的新版本”会被
// 409 拒绝，而不是仅仅证明 JSON 能序列化。

import type { NestExpressApplication } from '@nestjs/platform-express'
import type { AddressInfo } from 'node:net'
import type { PrismaService } from '../../prisma.service'
import type { SeededTeam } from './pg-harness'
import process from 'node:process'
import { ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthModule } from '../../auth/auth.module'
import { AuthService } from '../../auth/auth.service'
import { PrismaModule } from '../../prisma.module'
import { SharesModule } from '../../shares/shares.module'
import {
  createPrisma,
  resetDatabase,
  resolveTestDatabaseUrl,
  seedTeams,
} from './pg-harness'

describe('Share REST optimistic concurrency (real Nest + PostgreSQL)', () => {
  let app: NestExpressApplication
  let prisma: PrismaService
  let authService: AuthService
  let baseUrl: string
  let ctx: SeededTeam
  let ownerToken: string
  let memberToken: string
  const shareId = 'nest-share-1'

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl()
    prisma = createPrisma()
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        AuthModule,
        SharesModule,
      ],
    }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>()
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}/api/v1`
    authService = app.get(AuthService)
  })

  afterAll(async () => {
    await app?.close()
    await prisma?.onModuleDestroy()
  })

  beforeEach(async () => {
    await resetDatabase(prisma)
    ctx = await seedTeams(prisma)
    ownerToken = (await authService.createToken(ctx.creatorId, 'owner')).token
    memberToken = (await authService.createToken(ctx.memberId, 'member')).token
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Share" (id, "teamId", type, data, permission, "sharedBy", "isSensitive", "encryptedData", "createdAt", "updatedAt")
       VALUES ($1, $2, 'HOST', $3::jsonb, 'READWRITE', $4, false, NULL, now(), now())`,
      shareId,
      ctx.teamId,
      JSON.stringify({ name: 'web-1' }),
      ctx.creatorId,
    )
  })

  async function api(
    path: string,
    options: RequestInit = {},
    token = ownerToken,
  ): Promise<{ status: number, body: unknown, text: string }> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token === '' ? {} : { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    })
    const text = await response.text()
    return {
      status: response.status,
      body: text === '' ? null : JSON.parse(text),
      text,
    }
  }

  function updateBody(baseVersion: number | string | undefined, name: string) {
    return JSON.stringify({
      ...(baseVersion === undefined ? {} : { baseVersion }),
      data: { name },
    })
  }

  async function versionOf(id = shareId): Promise<number> {
    const row = await prisma.share.findUniqueOrThrow({ where: { id } })
    return Number(row.version)
  }

  it('serves GET with a JSON-number version through the real adapter', async () => {
    const single = await api(`/teams/${ctx.teamId}/shares/${shareId}`)
    expect(single.status).toBe(200)
    expect(typeof (single.body as { version: unknown }).version).toBe('number')

    const list = await api(`/teams/${ctx.teamId}/shares`)
    expect(list.status).toBe(200)
    expect(Array.isArray(list.body)).toBe(true)
    expect(
      typeof (list.body as Array<{ version: unknown }>)[0].version,
    ).toBe('number')
  })

  it('creates a share and returns the server-issued version', async () => {
    const response = await api(`/teams/${ctx.teamId}/shares`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'HOST',
        data: { name: 'created' },
        permission: 'READWRITE',
      }),
    })
    expect(response.status).toBe(201)
    expect(typeof (response.body as { version: unknown }).version).toBe('number')
  })

  it('rejects a stale PUT with 409 and keeps the newer writer data', async () => {
    const version = await versionOf()
    const first = await api(`/teams/${ctx.teamId}/shares/${shareId}`, {
      method: 'PUT',
      body: updateBody(version, 'client-a'),
    })
    expect(first.status).toBe(200)

    const stale = await api(`/teams/${ctx.teamId}/shares/${shareId}`, {
      method: 'PUT',
      body: updateBody(version, 'client-b'),
    })
    expect(stale.status).toBe(409)
    expect((stale.body as { message: string }).message).toMatch(
      /modified concurrently/,
    )

    const share = await prisma.share.findUniqueOrThrow({ where: { id: shareId } })
    expect(share.data).toEqual({ name: 'client-a' })
    expect(Number(share.version)).toBe(version + 1)
  })

  it('rejects a stale PUT even when both writes share the same millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-03T00:00:00.000Z'))
    try {
      const version = await versionOf()
      expect(
        (
          await api(`/teams/${ctx.teamId}/shares/${shareId}`, {
            method: 'PUT',
            body: updateBody(version, 'same-ms-a'),
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await api(`/teams/${ctx.teamId}/shares/${shareId}`, {
            method: 'PUT',
            body: updateBody(version, 'same-ms-b'),
          })
        ).status,
      ).toBe(409)
      const share = await prisma.share.findUniqueOrThrow({
        where: { id: shareId },
      })
      expect(share.data).toEqual({ name: 'same-ms-a' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires baseVersion and fails closed with 428 when it is missing', async () => {
    const response = await api(`/teams/${ctx.teamId}/shares/${shareId}`, {
      method: 'PUT',
      body: updateBody(undefined, 'unconditional'),
    })
    expect(response.status).toBe(428)
    const share = await prisma.share.findUniqueOrThrow({ where: { id: shareId } })
    expect(share.data).toEqual({ name: 'web-1' })
  })

  it('rejects invalid baseVersion payloads with 400', async () => {
    for (const baseVersion of [-1, 1.5]) {
      const response = await api(`/teams/${ctx.teamId}/shares/${shareId}`, {
        method: 'PUT',
        body: updateBody(baseVersion, 'invalid'),
      })
      expect(response.status, `baseVersion=${baseVersion}`).toBe(400)
      expect((response.body as { message: unknown }).message).toBeDefined()
    }
  })

  it('enforces creator-or-READWRITE permission before the CAS', async () => {
    await prisma.share.update({
      where: { id: shareId },
      data: { permission: 'READONLY' },
    })
    const version = await versionOf()
    const response = await api(
      `/teams/${ctx.teamId}/shares/${shareId}`,
      { method: 'PUT', body: updateBody(version, 'member-write') },
      memberToken,
    )
    expect(response.status).toBe(403)
  })

  it('returns 404 for a missing share and 401 without an API key', async () => {
    const missing = await api(`/teams/${ctx.teamId}/shares/does-not-exist`)
    expect(missing.status).toBe(404)

    const unauthenticated = await api(
      `/teams/${ctx.teamId}/shares/${shareId}`,
      {},
      '',
    )
    expect(unauthenticated.status).toBe(401)
  })

  it('rejects unknown fields and missing required create fields with 400', async () => {
    const unknownField = await api(`/teams/${ctx.teamId}/shares`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'HOST',
        data: { name: 'x' },
        permission: 'READWRITE',
        unexpected: true,
      }),
    })
    expect(unknownField.status).toBe(400)
    expect((unknownField.body as { message: unknown }).message).toBeDefined()

    const missingPermission = await api(`/teams/${ctx.teamId}/shares`, {
      method: 'POST',
      body: JSON.stringify({ type: 'HOST', data: { name: 'x' } }),
    })
    expect(missingPermission.status).toBe(400)
  })
})
