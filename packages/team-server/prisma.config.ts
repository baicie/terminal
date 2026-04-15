import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),

  migrate: {
    async development() {
      const { PrismaPostgres } = await import('@prisma/adapter-pg')
      const { Pool } = await import('pg')

      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      })

      const adapter = new PrismaPostgres(pool)
      return { adapter }
    },
  },
})
