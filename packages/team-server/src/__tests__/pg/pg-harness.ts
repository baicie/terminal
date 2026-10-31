import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Client } from 'pg'
import { PrismaService } from '../../prisma.service'

const PACKAGE_ROOT = path.resolve(__dirname, '../../..')
const DEFAULT_DATABASE = 'team_server_p85_test'

export interface SeededTeam {
  teamId: string
  otherTeamId: string
  creatorId: string
  memberId: string
  outsiderId: string
}

export function resolveTestDatabaseUrl(): string {
  return (
    process.env.TEAM_SERVER_TEST_DATABASE_URL
    ?? `postgresql://${os.userInfo().username}@127.0.0.1:5432/${DEFAULT_DATABASE}`
  )
}

export async function ensureTestDatabase(): Promise<void> {
  const target = new URL(resolveTestDatabaseUrl())
  const database = decodeURIComponent(target.pathname.replace(/^\//, ''))
  target.pathname = '/postgres'
  const client = new Client({ connectionString: target.toString() })
  await client.connect()
  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    )
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`)
    }
  } finally {
    await client.end()
  }
}

export function applyMigrations(): void {
  execFileSync(
    process.execPath,
    [
      path.join(PACKAGE_ROOT, 'node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
    ],
    {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, DATABASE_URL: resolveTestDatabaseUrl() },
      stdio: 'pipe',
    },
  )
}

export function createPrisma(): PrismaService {
  process.env.DATABASE_URL = resolveTestDatabaseUrl()
  return new PrismaService()
}

export async function connectRaw(): Promise<Client> {
  const client = new Client({ connectionString: resolveTestDatabaseUrl() })
  await client.connect()
  return client
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Share", "AuditLog", "SyncQueue", "TeamMember", "Invite", "ApiToken", "Team", "User" RESTART IDENTITY CASCADE',
  )
}

export async function seedTeams(prisma: PrismaService): Promise<SeededTeam> {
  const creatorId = 'user-creator'
  const memberId = 'user-member'
  const outsiderId = 'user-outsider'
  await prisma.user.createMany({
    data: [{ id: creatorId }, { id: memberId }, { id: outsiderId }],
  })
  const team = await prisma.team.create({
    data: { name: 'Team A', ownerId: creatorId },
  })
  const otherTeam = await prisma.team.create({
    data: { name: 'Team B', ownerId: outsiderId },
  })
  await prisma.teamMember.createMany({
    data: [
      { teamId: team.id, userId: creatorId, role: 'ADMIN' },
      { teamId: team.id, userId: memberId, role: 'MEMBER' },
      { teamId: otherTeam.id, userId: outsiderId, role: 'ADMIN' },
    ],
  })
  return {
    teamId: team.id,
    otherTeamId: otherTeam.id,
    creatorId,
    memberId,
    outsiderId,
  }
}

export async function waitForBlockedWriters(
  prisma: PrismaService,
  expected: number,
  timeoutMs = 5000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let blocked = 0
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRawUnsafe<Array<{ blocked: number }>>(
      'SELECT count(*)::int AS blocked FROM pg_locks WHERE NOT granted',
    )
    blocked = rows[0]?.blocked ?? 0
    if (blocked >= expected) return blocked
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return blocked
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
