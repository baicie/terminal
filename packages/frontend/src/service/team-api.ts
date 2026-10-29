/** Team API service facade and response converters. */
import { TeamApiSync } from './team-api-sync'

export {
  convertApiAuditLog,
  convertApiInvite,
  convertApiMember,
  convertApiShare,
  convertApiTeam,
} from './team-api-converters'

/** The singleton retains the original configurable class-instance semantics. */
export const teamApi = new TeamApiSync()
