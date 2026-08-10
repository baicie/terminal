import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('team-server Docker healthcheck', () => {
  it('probes the database-backed readiness endpoint', () => {
    const compose = readFileSync(
      join(__dirname, '../../docker-compose.yml'),
      'utf8',
    )
    const teamServerService = compose.split('\n  db:', 1)[0]

    expect(teamServerService).toContain(
      'http://127.0.0.1:3000/api/v1/health/ready',
    )
    expect(teamServerService).not.toContain(
      'http://127.0.0.1:3000/api/v1/health/live',
    )
  })

  it('ships a Compose-ready database environment example', () => {
    const environment = readFileSync(
      join(__dirname, '../../.env.example'),
      'utf8',
    )

    expect(environment).toContain('POSTGRES_PASSWORD=')
    expect(environment).toContain('@db:5432/')
    expect(environment).not.toContain('@localhost:5432/')
  })
})
