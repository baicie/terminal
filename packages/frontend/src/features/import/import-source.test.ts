// Phase 10.2-B1 — the import wizard's read/plan layer.
//
// The parser and the planner were already tested. What was missing was the layer
// between the file system and the UI: reading exactly the file the user chose,
// refusing an empty or unreadable one with a sentence they can act on, and
// planning against the hosts already stored so a second import does nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import { planOpenSshImport } from './import-source'
import { materialiseImport } from './import-plan'

const mocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  homeDir: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: mocks.readTextFile,
}))

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: mocks.homeDir,
}))

const { expandHome, readSshConfigFile } = await import('./ssh-config-file')
const { loadOpenSshImport } = await import('./import-source')

const CONFIG = `
Host bastion
  HostName bastion.example.test
  User admin
  IdentityFile ~/.ssh/id_ed25519

Host web
  HostName web.example.test
  User deploy
  Port 2222
`

function existing(overrides: Partial<Host> = {}): Host {
  return {
    id: 'existing-1',
    name: 'web',
    hostname: 'web.example.test',
    port: 2222,
    username: 'deploy',
    authType: 'key',
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Host
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.homeDir.mockResolvedValue('/Users/tester')
  mocks.readTextFile.mockResolvedValue(CONFIG)
})

describe('planning a config that the user supplied', () => {
  it('produces one creatable candidate per new host', () => {
    const result = planOpenSshImport(CONFIG, {
      path: '~/.ssh/config',
      existingHosts: [],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.source.path).toBe('~/.ssh/config')
    expect(result.source.plan.candidates).toHaveLength(2)
    expect(result.source.plan.summary.creatable).toBe(2)
  })

  it('marks a host that is already saved as a duplicate, not creatable', () => {
    const result = planOpenSshImport(CONFIG, {
      path: '~/.ssh/config',
      existingHosts: [existing()],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const web = result.source.plan.candidates.find(c => c.name === 'web')
    expect(web?.decision).toBe('duplicate')
    expect(web?.selectedByDefault).toBe(false)
    // The bastion is new, so it stays importable.
    expect(
      result.source.plan.candidates.find(c => c.name === 'bastion')?.decision,
    ).toBe('create')
  })

  it('refuses a file with no Host block instead of reporting "0 imported"', () => {
    const result = planOpenSshImport('# nothing here\n', {
      path: 'empty',
      existingHosts: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/no hosts/i)
  })
})

describe('reading the file the user picked', () => {
  it('reads exactly the path it was given', async () => {
    const result = await loadOpenSshImport([], '/tmp/some-config')
    expect(result.ok).toBe(true)
    expect(mocks.readTextFile).toHaveBeenCalledWith('/tmp/some-config')
  })

  it('expands a leading ~ so the file API gets a real path', async () => {
    expect(await expandHome('~/.ssh/config')).toBe('/Users/tester/.ssh/config')
    expect(await expandHome('~')).toBe('/Users/tester')
    // `~otheruser` is not resolved: reading another user's home is not this
    // importer's business.
    expect(await expandHome('~otheruser/.ssh/config')).toBe('~otheruser/.ssh/config')
    expect(await expandHome('/abs/path')).toBe('/abs/path')
  })

  it('says the file is missing rather than showing a raw error', async () => {
    mocks.readTextFile.mockRejectedValue(new Error('No such file or directory'))
    const result = await readSshConfigFile('~/.ssh/config')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/\/Users\/tester\/\.ssh\/config/)
    expect(result.message).toMatch(/no ssh config/i)
  })

  it('separates "cannot open it" from "it is not there"', async () => {
    mocks.readTextFile.mockRejectedValue(new Error('Permission denied'))
    const result = await readSshConfigFile('/etc/ssh/ssh_config')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/permission/i)
  })

  it('reports an unreadable home directory instead of guessing a path', async () => {
    mocks.homeDir.mockRejectedValue(new Error('no home'))
    const result = await readSshConfigFile('~/.ssh/config')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/home directory/i)
  })
})

describe('the wizard never imports something it cannot honour', () => {
  it('carries warnings through to the plan for the preview to show', () => {
    const result = planOpenSshImport(
      `
Host *
  User wildcard-user

Host real
  HostName real.example.test
  UnknownKeyword whatever
`,
      { path: 'cfg', existingHosts: [] },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Wildcards are not hosts and unknown keywords are not silently accepted;
    // both must reach the preview.
    const messages = result.source.plan.warnings.map(w => w.message).join(' ')
    expect(messages).toMatch(/pattern|unknown/i)
  })

  it('does not materialise a duplicate even if the caller selects everything', () => {
    const result = planOpenSshImport(CONFIG, {
      path: 'cfg',
      existingHosts: [existing()],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const allIds = new Set(result.source.plan.candidates.map(c => c.id))
    // `materialiseImport` is the gate; selecting a duplicate must not create it.
    const rows = materialiseImport(result.source.plan.candidates, allIds)
    expect(rows.map(r => r.name)).toEqual(['bastion'])
  })
})
