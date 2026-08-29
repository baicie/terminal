import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    // Keep `prisma generate` usable before runtime environment injection while
    // ensuring migration commands cannot accidentally target a local database.
    // Production and deployment commands must provide DATABASE_URL explicitly.
    url: process.env.DATABASE_URL ?? 'postgresql://127.0.0.1:1/terminal_dev',
  },
  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
})
