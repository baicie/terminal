import {
  applyMigrations,
  ensureTestDatabase,
  resolveTestDatabaseUrl,
} from './pg-harness'

export default async function setup(): Promise<void> {
  await ensureTestDatabase()
  applyMigrations()
  process.env.TEAM_SERVER_TEST_DATABASE_URL = resolveTestDatabaseUrl()
}
