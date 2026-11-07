// The current server, booted as its own process for the cross-version run.
//
// It is deliberately not one of the vitest workers: the historical client and
// the current clients must talk to the same live server over real HTTP, and a
// test worker that also hosts the server would hide a crash or a reload behind
// the harness. Everything below is the production AppModule, the production
// guards and pipes; only the database name and the registration mode are test
// settings.
import type { AddressInfo } from 'node:net'
import { writeFileSync } from 'node:fs'

async function main(): Promise<void> {
  process.env.NODE_ENV = 'test'
  process.env.REGISTRATION_MODE = 'open'

  const { ValidationPipe } = await import('@nestjs/common')
  const { Test } = await import('@nestjs/testing')
  const { AppModule } = await import('../app.module')
  const { PrismaService } = await import('../prisma.service')
  const {
    applyMigrations,
    ensureTestDatabase,
    resetDatabase,
    resolveTestDatabaseUrl,
  } = await import('../__tests__/pg/pg-harness')

  const databaseUrl = resolveTestDatabaseUrl()
  process.env.DATABASE_URL = databaseUrl
  process.env.TEAM_SERVER_TEST_DATABASE_URL = databaseUrl

  await ensureTestDatabase()
  applyMigrations()

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleRef.createNestApplication()
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(0, '127.0.0.1')
  await resetDatabase(app.get(PrismaService))

  const address = app.getHttpServer().address() as AddressInfo
  const readyFile = process.env.TEAM_SYNC_E2E_READY_FILE
  if (readyFile === undefined || readyFile === '') {
    throw new Error('TEAM_SYNC_E2E_READY_FILE is not set')
  }
  writeFileSync(
    readyFile,
    JSON.stringify({ base: `http://127.0.0.1:${address.port}` }),
  )

  const shutdown = async (): Promise<void> => {
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((error: unknown) => {
  console.error('[cross-version server] failed to start', error)
  process.exit(1)
})
