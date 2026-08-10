import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamState } from './team-types'

const database = vi.hoisted(() => ({
  createTeamInvite: vi.fn(),
}))

vi.mock('@/service/database', () => database)

import { createCoreActions } from './team-actions-core'

describe('createCoreActions.createInvite', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses browser cryptographic randomness for every invite-code character', async () => {
    const state = {
      invites: [],
      teams: [
        {
          autoSync: false,
          createdAt: 0,
          id: 'team-id',
          mode: 'local',
          name: 'Alpha',
          ownerId: 'user-id',
          updatedAt: 0,
        },
      ],
      userProfile: { createdAt: 0, id: 'user-id', name: 'User', updatedAt: 0 },
    } as unknown as TeamState
    const set = (
      partial: Partial<TeamState> | ((value: TeamState) => Partial<TeamState>),
    ) => {
      Object.assign(
        state,
        typeof partial === 'function' ? partial(state) : partial,
      )
    }
    const cryptoRandom = vi.spyOn(crypto, 'getRandomValues')
    const mathRandom = vi.spyOn(Math, 'random')
    const actions = createCoreActions(set, () => state)

    const invite = await actions.createInvite('team-id', 'code')

    expect(invite.code).toMatch(/^TEAM-ALPH-[A-Z2-9]{4}$/)
    expect(mathRandom).not.toHaveBeenCalled()
    expect(cryptoRandom).toHaveBeenCalledOnce()
    expect(cryptoRandom.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect((cryptoRandom.mock.calls[0][0] as Uint8Array).length).toBe(4)
  })
})
