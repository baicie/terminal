import { randomInt } from 'node:crypto'
import { customAlphabet } from 'nanoid'

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

type RandomIndex = (maximum: number) => number

export const LINK_TOKEN_LENGTH = 24
export const LINK_TOKEN_HEAD_ALPHABET
  = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const LINK_TOKEN_BODY_ALPHABET = `${LINK_TOKEN_HEAD_ALPHABET}-_`

const createLinkTokenHead = customAlphabet(LINK_TOKEN_HEAD_ALPHABET, 1)
const createLinkTokenBody = customAlphabet(
  LINK_TOKEN_BODY_ALPHABET,
  LINK_TOKEN_LENGTH - 1,
)

export function generateInviteCode(
  randomIndex: RandomIndex = randomInt,
): string {
  const characters = Array.from(
    { length: 8 },
    () => INVITE_ALPHABET[randomIndex(INVITE_ALPHABET.length)],
  ).join('')
  return `TEAM-${characters.slice(0, 4)}-${characters.slice(4)}`
}

export function generateLinkToken(): string {
  return `${createLinkTokenHead()}${createLinkTokenBody()}`
}
