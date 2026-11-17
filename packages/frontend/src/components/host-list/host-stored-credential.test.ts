// The three-state rule for "does this host have something stored".
//
// The bug this encodes against: `credentialRef: null` meant two different things
// and only one of them was checked. A readable reference gives `kinds`; a damaged
// one gives `null` inside the mapper because there is no name the build can use.
// The secret is still in the provider in both cases, so "cannot read it" and
// "stores nothing" must not be the same input state.

import { describe, expect, it } from 'vitest'
import type { Host } from '@/types'
import { storedCredentialState } from './host-stored-credential'

const base = {
  id: 'h-1',
  name: 'prod',
  hostname: 'prod.test',
  port: 22,
  username: 'deploy',
  authType: 'password',
} as unknown as Host

describe('storedCredentialState', () => {
  it('reports a readable reference and offers clear', () => {
    const state = storedCredentialState({
      ...base,
      credentialRef: { kinds: ['password'], provider: 'vault', version: 3 },
      credentialRefProblem: null,
    } as unknown as Host)
    expect(state).toEqual({ hasReadable: true, hasDamaged: false, canClear: true })
  })

  it('reports a damaged reference and still offers clear', () => {
    // The recovery path. Offering nothing here is what forced users to delete the
    // host, its groups, its tags and its favourites to escape a pointer the build
    // could not follow.
    for (const problem of [
      { kind: 'malformed', detail: 'not valid JSON' },
      { kind: 'unknown-provider', provider: 'system-keychain' },
      { kind: 'unsupported-version', version: 2_000_000_000 },
      { kind: 'empty-kinds' },
    ] as const) {
      const state = storedCredentialState({
        ...base,
        credentialRef: null,
        credentialRefProblem: problem,
      } as unknown as Host)
      expect(state, `problem ${problem.kind}`).toEqual({
        hasReadable: false,
        hasDamaged: true,
        canClear: true,
      })
    }
  })

  it('offers nothing when the host genuinely stores no credential', () => {
    // Agent auth, or a host that prompts at connect time. A clear button here
    // would be a button that does nothing.
    const state = storedCredentialState({
      ...base,
      credentialRef: null,
      credentialRefProblem: null,
    } as unknown as Host)
    expect(state).toEqual({ hasReadable: false, hasDamaged: false, canClear: false })
  })

  it('offers nothing for an undefined or null host (new host dialog)', () => {
    expect(storedCredentialState(undefined).canClear).toBe(false)
    expect(storedCredentialState(null).canClear).toBe(false)
  })

  it('offers nothing for a reference whose kinds list is empty', () => {
    // An empty kinds list is contradictory — the parser refuses it as
    // `empty-kinds`, so it arrives as a *problem*. If one ever reaches here
    // unparsed, treating it as readable would render a control for a reference
    // that names no secret.
    const state = storedCredentialState({
      ...base,
      credentialRef: { kinds: [], provider: 'vault', version: 1 },
      credentialRefProblem: null,
    } as unknown as Host)
    expect(state.canClear).toBe(false)
  })
})
