// Phase 10.2-B2/B3 — an OpenSSH import must not produce a host that cannot connect.
//
// Two distinct defects in `materialiseImport`:
//
// B2. `identityFile` is a *path* on disk. The import puts it in `privateKey`, and
//     `privateKey` is what the connection hands to the SSH layer as key material.
//     The result is a host that imports cleanly and then fails authentication
//     because "the private key" is the string `~/.ssh/id_ed25519`. The row also
//     looks like it stores a key, so nothing prompts the user to fix it.
//
// B3. `proxyJump` in an ssh config is an *alias* (`bastion`), or a
//     `user@host:port` triple. `jumpHostId` is this app's internal host id
//     (`import-<host>-<port>-<user>`). Writing the alias there produces a
//     reference to a host that does not exist, and silently drops the jump
//     requirement — the import reports success for a host that can only connect
//     through a bastion.
//
// The rule both share: a value that cannot be honoured must be surfaced, never
// stored under a name that claims it was.

import { describe, expect, it } from 'vitest'
import { parseSshConfig } from './ssh-config-parser'
import { materialiseImport, planImport } from './import-plan'
import type { ImportPlan } from './import-plan'

const CONFIG = `
Host bastion
  HostName bastion.example.test
  User admin
  Port 2200
  IdentityFile ~/.ssh/id_ed25519

Host db
  HostName db.internal
  User deploy
  Port 22
  IdentityFile ~/.ssh/id_ed25519

Host proxied
  HostName app.internal
  User deploy
  ProxyJump bastion
`

function planFor(config = CONFIG): ImportPlan {
  return planImport(parseSshConfig(config), { existingHosts: [] })
}

function materialiseAll(config = CONFIG) {
  const plan = planFor(config)
  const ids = new Set(
    plan.candidates
      .filter(candidate => candidate.decision === 'create')
      .map(candidate => candidate.id),
  )
  return { plan, rows: materialiseImport(plan.candidates, ids) }
}

describe('B2 — an IdentityFile path is never stored as key material', () => {
  it('does not put the path into privateKey', () => {
    const { rows } = materialiseAll()
    const db = rows.find(row => row.name === 'db')
    expect(db).toBeDefined()

    // `privateKey` means "PEM content" everywhere else in the app. A path in it
    // is a lie that fails at connect time with an unrelated parser error.
    const key = db?.privateKey
    expect(key === undefined || key === null || !String(key).includes('/')).toBe(true)
    expect(String(key ?? '')).not.toContain('id_ed25519')
  })

  it('records the path under a field that means "a file to read"', () => {
    const { rows } = materialiseAll()
    const db = rows.find(row => row.name === 'db')

    // The path must not simply be discarded either — the user needs to see that
    // this host expects a key file, and where.
    const row = db as unknown as Record<string, unknown>
    const referenced =
      row.identityFilePath ?? row.keyFilePath ?? row.sshIdentityFile ?? null
    expect(referenced).toBe('~/.ssh/id_ed25519')
  })

  it('keeps authType as the intent, with the path as the source of the key', () => {
    const { rows } = materialiseAll()
    const db = rows.find(row => row.name === 'db')

    // `authType: 'key'` describes what the user intends to authenticate with,
    // not where the bytes are stored. The ImportFile path is the source; the
    // connection reads it. What must never happen is the path landing in
    // `privateKey`, which the tests above already lock.
    expect(db?.authType).toBe('key')
    expect(db?.identityFilePath).toBe('~/.ssh/id_ed25519')
    expect(db?.privateKey).toBeUndefined()
  })
})

describe('B3 — a ProxyJump alias is resolved, not stored as an id', () => {
  it('points jumpHostId at the imported host it names', () => {
    const { plan, rows } = materialiseAll()
    const proxied = rows.find(row => row.name === 'proxied')
    const bastion = rows.find(row => row.name === 'bastion')
    expect(proxied).toBeDefined()
    expect(bastion).toBeDefined()

    // The alias `bastion` was imported in this same file, so it must resolve to
    // that row's id — not to the literal string `bastion`.
    expect(proxied?.jumpHostId).toBe(bastion?.id)
    expect(proxied?.jumpHostId).not.toBe('bastion')
    void plan
  })

  it('reports a ProxyJump it cannot resolve instead of dropping it', () => {
    // `missing` is not defined anywhere in this file and does not exist locally.
    const plan = planFor(`
Host orphan
  HostName orphan.internal
  User deploy
  ProxyJump missing
`)

    const orphan = plan.candidates.find(candidate => candidate.name === 'orphan')
    expect(orphan).toBeDefined()

    // Silently importing it as a direct connection would be a lie: the host is
    // only reachable through a bastion.
    expect(orphan?.decision).not.toBe('create')
    const mentioned = plan.warnings.some(w =>
      JSON.stringify(w).toLowerCase().includes('proxyjump'),
    )
    expect(mentioned).toBe(true)
  })

  it('resolves user@host:port form to the alias it names', () => {
    const { rows } = materialiseAll(`
Host bastion
  HostName bastion.example.test
  User admin

Host via-form
  HostName via.example.test
  User deploy
  ProxyJump admin@bastion:2200
`)
    const via = rows.find(row => row.name === 'via-form')
    const bastion = rows.find(row => row.name === 'bastion')
    expect(via?.jumpHostId).toBe(bastion?.id)
  })

  it('a host with no ProxyJump keeps a null jumpHostId', () => {
    const { rows } = materialiseAll(`
Host plain
  HostName plain.example.test
  User deploy
`)
    const plain = rows.find(row => row.name === 'plain')
    expect(plain?.jumpHostId ?? null).toBeNull()
  })
})

describe('B3 — a ProxyJump never resolves to a row that will not be inserted', () => {
  it('points at the saved host id when the bastion is already in the database', () => {
    // The bastion is already saved, so this file's copy of it is a duplicate and
    // is never inserted. The jump must name the row that exists — not the
    // candidate id that `materialiseImport` will skip.
    const plan = planImport(parseSshConfig(`
Host bastion
  HostName bastion.example.test
  User admin

Host db
  HostName db.internal
  User deploy
  ProxyJump bastion
`), {
      existingHosts: [
        {
          id: 'uuid-of-the-saved-bastion',
          name: 'bastion',
          hostname: 'bastion.example.test',
          port: 22,
          username: 'admin',
          authType: 'key',
          isFavorite: false,
          portForwards: [],
          createdAt: 0,
          updatedAt: 0,
        } as never,
      ],
    })

    const bastion = plan.candidates.find(c => c.name === 'bastion')
    expect(bastion?.decision).toBe('duplicate')

    const db = plan.candidates.find(c => c.name === 'db')
    expect(db?.decision).toBe('create')
    // The id that actually exists, not the never-inserted candidate id.
    expect(db?.resolvedJumpHostId).toBe('uuid-of-the-saved-bastion')
  })

  it('still resolves to the new candidate when the bastion is being imported', () => {
    const plan = planImport(parseSshConfig(`
Host bastion
  HostName bastion2.example.test
  User admin

Host db2
  HostName db2.internal
  User deploy
  ProxyJump bastion
`), { existingHosts: [] })

    const bastion = plan.candidates.find(c => c.name === 'bastion')
    const db = plan.candidates.find(c => c.name === 'db2')
    expect(bastion?.decision).toBe('create')
    expect(db?.resolvedJumpHostId).toBe(bastion?.id)
  })
})
