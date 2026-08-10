import { createHash } from 'node:crypto'

const TOKEN_HASH_PREFIX = 'sha256:'
const HEX_CHARACTERS = '0123456789abcdef'

export function legacyHashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function hashApiToken(token: string): string {
  return `${TOKEN_HASH_PREFIX}${legacyHashApiToken(token)}`
}

export function isEncodedApiTokenHash(token: string): boolean {
  const hasPrefix = token.startsWith(TOKEN_HASH_PREFIX)
  const digest = hasPrefix ? token.slice(TOKEN_HASH_PREFIX.length) : token
  return (
    (hasPrefix || token.length === 64) &&
    digest.length === 64 &&
    [...digest.toLowerCase()].every(character =>
      HEX_CHARACTERS.includes(character),
    )
  )
}
