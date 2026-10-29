import { randomInt } from 'node:crypto'

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

type RandomIndex = (maximum: number) => number

export function generateInviteCode(
  randomIndex: RandomIndex = randomInt,
): string {
  const characters = Array.from(
    { length: 8 },
    () => INVITE_ALPHABET[randomIndex(INVITE_ALPHABET.length)],
  ).join('')
  return `TEAM-${characters.slice(0, 4)}-${characters.slice(4)}`
}
