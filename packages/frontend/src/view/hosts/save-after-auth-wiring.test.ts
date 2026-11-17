// The wiring: when the prompt appears, and — more importantly — when it does not.
//
// `save-after-auth.test.ts` covers the decision and the write. This covers the path that
// connects them to a real connection lifecycle, because the failure mode that matters is
// not "the decision is wrong" but "the decision is never reached" or "it is reached at the
// wrong moment". Both are invisible without driving the two halves together.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  armSaveAfterAuthForTab,
  settleOnConnectionStatus,
} from './use-save-after-auth'
import { __resetPendingSavesForTests } from './pending-save'
import { __resetSavePromptForTests, useSavePromptStore } from './save-prompt-store'
import type { Host } from '@/types'
import {
  getTemporaryTerminalProfile,
  registerTemporaryTerminalProfile,
  removeTemporaryTerminalProfile,
  scrubTemporaryTerminalProfileSecrets,
} from '@/features/terminal/services/temporary-terminal-profiles'

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h-1',
    name: 'Prod',
    hostname: 'prod.example.com',
    port: 22,
    username: 'deploy',
    authType: 'password',
    isFavorite: false,
    group: '',
    tags: [],
    credentialRef: null,
    credentialRefProblem: null,
    ...overrides,
  } as Host
}

beforeEach(() => {
  __resetPendingSavesForTests()
  __resetSavePromptForTests()
})

describe('the prompt is raised only by a successful connection', () => {
  it('does not appear when the tab is merely created', () => {
    // Arming is not showing. This is the whole `Authenticate is not Save` rule: a tab
    // that has not connected has proven nothing.
    armSaveAfterAuthForTab('tab-1', host(), { password: 'p' }, 'p-tab-1')
    expect(useSavePromptStore.getState().pending).toBeNull()
  })

  it('appears once the tab reports connected', () => {
    armSaveAfterAuthForTab('tab-1', host(), { password: 'p' }, 'p-tab-1')
    const entry = settleOnConnectionStatus('tab-1', true)
    expect(entry).not.toBeNull()
    expect(entry?.secret.password).toBe('p')
  })

  it('never appears for a connection that failed', () => {
    // The dangerous case: a rejected password must not lead to a save prompt, because
    // answering it would store a credential already known not to work.
    armSaveAfterAuthForTab('tab-1', host(), { password: 'wrong' }, 'p-tab-1')
    const entry = settleOnConnectionStatus('tab-1', false)
    expect(entry).toBeNull()
  })

  it('drops the offer after a failure instead of holding it for a retry', () => {
    // A retry carries whatever the user types next, which is a different secret and
    // needs its own consent. Keeping the old one would offer to save a value the user
    // has already moved past.
    armSaveAfterAuthForTab('tab-1', host(), { password: 'wrong' }, 'p-tab-1')
    settleOnConnectionStatus('tab-1', false)
    expect(settleOnConnectionStatus('tab-1', true)).toBeNull()
  })

  it('asks once per connection, not on every reconnect', () => {
    // A reconnect emits `connected` again. Re-asking after the user already answered is
    // what makes a prompt feel broken, and `take` consuming the entry is what prevents
    // it.
    armSaveAfterAuthForTab('tab-1', host(), { password: 'p' }, 'p-tab-1')
    expect(settleOnConnectionStatus('tab-1', true)).not.toBeNull()
    expect(settleOnConnectionStatus('tab-1', true)).toBeNull()
  })

  it('does not offer for a tab that never armed anything', () => {
    // A host with a stored credential connects without a typed secret, so there is
    // nothing to save and no prompt should exist.
    expect(settleOnConnectionStatus('tab-1', true)).toBeNull()
  })

  it('keeps one tab\'s secret out of another tab\'s prompt', () => {
    // Two tabs, two different hosts, both connecting: each prompt must carry its own
    // host. A shared slot here would show the wrong hostname in the question and save
    // the secret onto the wrong row.
    armSaveAfterAuthForTab('tab-1', host({ id: 'h-1', name: 'One' }), { password: 'a' }, 'p-tab-1')
    armSaveAfterAuthForTab('tab-2', host({ id: 'h-2', name: 'Two' }), { password: 'b' }, 'p-tab-2')

    const second = settleOnConnectionStatus('tab-2', true)
    expect(second?.host.id).toBe('h-2')
    expect(second?.secret.password).toBe('b')

    const first = settleOnConnectionStatus('tab-1', true)
    expect(first?.host.id).toBe('h-1')
    expect(first?.secret.password).toBe('a')
  })

  it('drops the secret once the answer is given', () => {
    // The point of a one-time credential is that it stops existing. After the question
    // is answered there is no reason to keep the plaintext reachable.
    armSaveAfterAuthForTab('tab-1', host(), { password: 'p' }, 'p-tab-1')
    settleOnConnectionStatus('tab-1', true)
    // Taking again finds nothing: the entry was consumed by the first settle.
    expect(settleOnConnectionStatus('tab-1', true)).toBeNull()
  })
})

describe('the plaintext does not outlive the question', () => {
  it('scrubbing a profile keeps it connectable but drops the secret', () => {
    // A tab must keep its profile — `TerminalContainer` reads it to reconnect — but the
    // password has no reason to survive the answer. Without this the secret sits in
    // memory for as long as the tab is open, which is the "无限期残留" the brief names.
    const profileId = registerTemporaryTerminalProfile({
      ...host(),
      password: 'sekret',
    })
    expect(getTemporaryTerminalProfile(profileId)?.password).toBe('sekret')

    scrubTemporaryTerminalProfileSecrets(profileId)

    const after = getTemporaryTerminalProfile(profileId)
    expect(after).toBeDefined()
    expect(after?.password).toBeUndefined()
    // The identity is intact, so a reconnect still resolves the right host.
    expect(after?.hostname).toBe('prod.example.com')
    removeTemporaryTerminalProfile(profileId)
  })

  it('scrubbing an unknown profile is a no-op rather than a throw', () => {
    // A tab closed between arming and answering must not produce an error on the way out.
    expect(() => scrubTemporaryTerminalProfileSecrets('never-registered')).not.toThrow()
  })
})

describe('a superseded attempt does not resurrect', () => {
  it('a second arm replaces the first', () => {
    armSaveAfterAuthForTab('tab-1', host({ id: 'old' }), { password: 'old' }, 'p-tab-1')
    armSaveAfterAuthForTab('tab-1', host({ id: 'new' }), { password: 'new' }, 'p-tab-1')
    const entry = settleOnConnectionStatus('tab-1', true)
    expect(entry?.host.id).toBe('new')
    expect(entry?.secret.password).toBe('new')
  })
})
