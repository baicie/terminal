// Import planning: never overwrite, never duplicate, never copy a private key.

import { describe, expect, it } from 'vitest'
import type { Host } from '@/types'
import { importedHostId, materialiseImport, planImport } from './import-plan'
import { parseSshConfig } from './ssh-config-parser'

function existingHost(overrides: Partial<Host> & { name: string }): Host {
  return {
    id: `id-${overrides.name}`,
    hostname: `${overrides.name}.test`,
    port: 22,
    username: 'alice',
    authType: 'password',
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Host
}

const CONFIG = `
Host web
  HostName web.example.test
  User deploy
  IdentityFile ~/.ssh/id_ed25519

Host db
  HostName db.example.test
  User admin
  Port 2222
`

describe('planImport', () => {
  it('marks every new host creatable and pre-selected', () => {
    const plan = planImport(parseSshConfig(CONFIG), { existingHosts: [] })
    expect(plan.summary).toEqual({
      total: 2,
      creatable: 2,
      duplicates: 0,
      invalid: 0,
    })
    expect(plan.candidates.every(candidate => candidate.selectedByDefault)).toBe(true)
  })

  it('detects a duplicate by target (host + port + user)', () => {
    const plan = planImport(parseSshConfig(CONFIG), {
      existingHosts: [
        existingHost({
          name: 'mine',
          hostname: 'web.example.test',
          port: 22,
          username: 'deploy',
        }),
      ],
    })
    const web = plan.candidates.find(candidate => candidate.name === 'web')
    expect(web?.decision).toBe('duplicate')
    expect(web?.reason).toContain('mine')
    expect(web?.selectedByDefault).toBe(false)
  })

  it('detects a duplicate by name even when the target differs', () => {
    const plan = planImport(parseSshConfig(CONFIG), {
      existingHosts: [existingHost({ name: 'db', hostname: 'other.test' })],
    })
    const db = plan.candidates.find(candidate => candidate.name === 'db')
    expect(db?.decision).toBe('duplicate')
    expect(db?.reason).toContain('already exists')
  })

  it('never marks a duplicate as creatable', () => {
    const plan = planImport(parseSshConfig(CONFIG), {
      existingHosts: [existingHost({ name: 'web', hostname: 'web.example.test', username: 'deploy' })],
    })
    expect(plan.summary.creatable).toBe(1)
    expect(plan.summary.duplicates).toBe(1)
  })

  it('refuses a target the app cannot connect to', () => {
    const plan = planImport(
      parseSshConfig('Host bad\n  HostName not a host!\n'),
      { existingHosts: [] },
    )
    expect(plan.candidates[0].decision).toBe('invalid')
    expect(plan.summary.invalid).toBe(1)
    expect(plan.summary.creatable).toBe(0)
  })

  it('flags a repeated target inside the same file', () => {
    const plan = planImport(
      parseSshConfig('Host a\n  HostName same.test\nHost b\n  HostName same.test\n'),
      { existingHosts: [] },
    )
    expect(plan.candidates.filter(candidate => candidate.decision === 'create')).toHaveLength(1)
    expect(plan.candidates.filter(candidate => candidate.decision === 'duplicate')).toHaveLength(1)
  })

  it('carries the parser warnings through to the plan', () => {
    const plan = planImport(
      parseSshConfig('Include other.conf\nHost a\n  HostName a.test\n'),
      { existingHosts: [] },
    )
    expect(plan.warnings.some(warning => warning.kind === 'include')).toBe(true)
  })

  it('uses agent auth when there is no IdentityFile', () => {
    const plan = planImport(parseSshConfig('Host a\n  HostName a.test\n'), {
      existingHosts: [],
    })
    expect(plan.candidates[0].authType).toBe('agent')
  })

  it('uses key auth when an IdentityFile is present', () => {
    const plan = planImport(parseSshConfig(CONFIG), { existingHosts: [] })
    const web = plan.candidates.find(candidate => candidate.name === 'web')
    expect(web?.authType).toBe('key')
    expect(web?.identityFile).toBe('~/.ssh/id_ed25519')
  })
})

describe('importedHostId', () => {
  it('is stable for the same target', () => {
    const first = importedHostId({ hostname: 'web.example.test', port: 22 }, 'deploy')
    const second = importedHostId({ hostname: 'web.example.test', port: 22 }, 'deploy')
    expect(first).toBe(second)
  })

  it('differs for different users or ports', () => {
    const base = importedHostId({ hostname: 'a.test', port: 22 }, 'u1')
    expect(importedHostId({ hostname: 'a.test', port: 22 }, 'u2')).not.toBe(base)
    expect(importedHostId({ hostname: 'a.test', port: 23 }, 'u1')).not.toBe(base)
  })

  it('is safe as an id (lowercase, dashes)', () => {
    const id = importedHostId({ hostname: 'Web.Example.Test', port: 22 }, 'Deploy')
    expect(id).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('materialiseImport', () => {
  const plan = planImport(parseSshConfig(CONFIG), { existingHosts: [] })
  const allIds = new Set(plan.candidates.map(candidate => candidate.id))

  it('creates exactly the selected, creatable candidates', () => {
    const rows = materialiseImport(plan.candidates, allIds)
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.name).sort()).toEqual(['db', 'web'])
  })

  it('respects a partial selection', () => {
    const onlyWeb = new Set([plan.candidates[0].id])
    const rows = materialiseImport(plan.candidates, onlyWeb)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('web')
  })

  it('refuses to materialise a duplicate even if its id is selected', () => {
    const duplicatePlan = planImport(parseSshConfig(CONFIG), {
      existingHosts: [existingHost({ name: 'web', hostname: 'web.example.test', username: 'deploy' })],
    })
    const ids = new Set(duplicatePlan.candidates.map(candidate => candidate.id))
    const rows = materialiseImport(duplicatePlan.candidates, ids)
    expect(rows.map(row => row.name)).toEqual(['db'])
  })

  it('stores the key path as a reference and never key material', () => {
    const rows = materialiseImport(plan.candidates, allIds)
    const web = rows.find(row => row.name === 'web')
    expect(web?.privateKey).toBe('~/.ssh/id_ed25519')
    expect(JSON.stringify(web)).not.toContain('BEGIN')
  })

  it('is idempotent: importing twice with the same file yields identical rows', () => {
    const first = materialiseImport(plan.candidates, allIds, 1000)
    const reparsed = planImport(parseSshConfig(CONFIG), { existingHosts: [] })
    const second = materialiseImport(
      reparsed.candidates,
      new Set(reparsed.candidates.map(candidate => candidate.id)),
      2000,
    )
    expect(second.map(row => row.id)).toEqual(first.map(row => row.id))
  })

  it('a second import into a database that already has them creates nothing', () => {
    const first = materialiseImport(plan.candidates, allIds, 1000)
    const second = planImport(parseSshConfig(CONFIG), {
      existingHosts: first as unknown as Host[],
    })
    expect(second.summary.creatable).toBe(0)
    expect(materialiseImport(second.candidates, allIds)).toEqual([])
  })
})
