/**
 * HTTP response shape for a TeamMember.
 *
 * Prisma exposes `joinedTxid` as bigint for sync ordering. JSON.stringify
 * throws on bigint, so Nest answered 500 after the write; HTTP callers never
 * need the numeric transaction id. Keep the internal service value untouched
 * and serialize it as a string when crossing the HTTP boundary.
 */
export function teamMemberResponse<T extends { joinedTxid?: unknown }>(member: T) {
  return {
    ...member,
    joinedTxid:
      member.joinedTxid === undefined || member.joinedTxid === null
        ? member.joinedTxid
        : String(member.joinedTxid),
  }
}

export function teamResponse<T extends { members?: Array<{ joinedTxid?: unknown }> }>(team: T) {
  return {
    ...team,
    ...(Array.isArray(team.members)
      ? { members: team.members.map(teamMemberResponse) }
      : {}),
  }
}
