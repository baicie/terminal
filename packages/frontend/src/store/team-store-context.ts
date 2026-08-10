import type { TeamState } from './team-types'

export type TeamStoreSet = (
  partial: Partial<TeamState> | ((state: TeamState) => Partial<TeamState>),
) => void
export type TeamStoreGet = () => TeamState
