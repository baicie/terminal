export type TerminalSmokeAuthMode = 'key' | 'password' | 'agent' | 'cert'

export interface TerminalSmokeJumpConfig {
  host: string
  port: number
  username: string
  privateKey: string
  expectedHostKey: string
}

export interface TerminalSmokeSshConfig {
  host: string
  port: number
  username: string
  expectedHostKey: string
  authMode: TerminalSmokeAuthMode
  /** Present for key and cert modes; null otherwise. */
  privateKey: string | null
  /** Present for password mode; optional cert passphrase in cert mode. */
  password: string | null
  /** Present for cert mode; null otherwise. */
  certificate: string | null
  /** Present for the jump-host case; null otherwise. */
  jump: TerminalSmokeJumpConfig | null
}

const SSH_CONFIG_REQUIRED_KEYS = [
  'authMode',
  'expectedHostKey',
  'host',
  'port',
  'username',
]
const SSH_CONFIG_OPTIONAL_KEYS = ['certificate', 'jump', 'password', 'privateKey']
const JUMP_CONFIG_KEYS = [
  'expectedHostKey',
  'host',
  'port',
  'privateKey',
  'username',
].sort()
const AUTH_MODES = ['agent', 'cert', 'key', 'password']
const OPENSSH_PRIVATE_KEY_PREFIX = '-----BEGIN OPENSSH PRIVATE KEY-----\n'
const OPENSSH_PRIVATE_KEY_SUFFIX = '-----END OPENSSH PRIVATE KEY-----\n'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOpenSshPrivateKey(value: string): boolean {
  return (
    value.startsWith(OPENSSH_PRIVATE_KEY_PREFIX) &&
    value.endsWith(OPENSSH_PRIVATE_KEY_SUFFIX)
  )
}

function isOpenSshCertificate(value: string): boolean {
  return /^ssh-[^\s]+-cert-v01@openssh\.com [A-Za-z0-9+/]+={0,2}$/.test(value)
}

function isHostKey(value: string): boolean {
  return /^ssh-[^\s]+ [A-Za-z0-9+/]+={0,2}$/.test(value)
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

function validateLoopbackTarget(
  value: Record<string, unknown>,
  label: string,
): void {
  if (value.host !== '127.0.0.1') {
    throw new Error(
      `Invalid terminal smoke config: ${label} host must be 127.0.0.1`,
    )
  }
  if (
    !Number.isSafeInteger(value.port) ||
    (value.port as number) < 1 ||
    (value.port as number) > 65_535
  ) {
    throw new Error(`Invalid terminal smoke config: ${label} port`)
  }
  if (
    typeof value.username !== 'string' ||
    value.username.trim() !== value.username ||
    value.username.length === 0 ||
    hasControlCharacters(value.username)
  ) {
    throw new Error(`Invalid terminal smoke config: ${label} username`)
  }
  if (
    typeof value.expectedHostKey !== 'string' ||
    !isHostKey(value.expectedHostKey)
  ) {
    throw new Error(`Invalid terminal smoke config: ${label} host key`)
  }
}

function parseOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid terminal smoke config: ${label}`)
  }
  return value
}

function parseJumpConfig(value: unknown): TerminalSmokeJumpConfig | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error('Invalid terminal smoke config: jump')
  const keys = Object.keys(value).sort()
  if (
    keys.length !== JUMP_CONFIG_KEYS.length ||
    keys.some((key, index) => key !== JUMP_CONFIG_KEYS[index])
  ) {
    throw new Error('Invalid terminal smoke config: jump')
  }
  validateLoopbackTarget(value, 'jump')
  const privateKey = value.privateKey
  if (typeof privateKey !== 'string' || !isOpenSshPrivateKey(privateKey)) {
    throw new Error('Invalid terminal smoke config: jump private key')
  }
  return {
    host: value.host as string,
    port: value.port as number,
    username: value.username as string,
    privateKey,
    expectedHostKey: value.expectedHostKey as string,
  }
}

export function parseTerminalSmokeSshConfig(
  raw: unknown,
): TerminalSmokeSshConfig {
  if (!isRecord(raw)) throw new Error('Invalid terminal smoke config')
  const keys = Object.keys(raw)
  const allowedKeys = [...SSH_CONFIG_REQUIRED_KEYS, ...SSH_CONFIG_OPTIONAL_KEYS]
  if (
    keys.some(key => !allowedKeys.includes(key)) ||
    SSH_CONFIG_REQUIRED_KEYS.some(key => !(key in raw))
  ) {
    throw new Error('Invalid terminal smoke config')
  }
  validateLoopbackTarget(raw, 'ssh')
  const authMode = raw.authMode
  if (typeof authMode !== 'string' || !AUTH_MODES.includes(authMode)) {
    throw new Error('Invalid terminal smoke config: auth mode')
  }
  const privateKey = parseOptionalString(raw.privateKey, 'private key')
  const password = parseOptionalString(raw.password, 'password')
  const certificate = parseOptionalString(raw.certificate, 'certificate')
  const jump = parseJumpConfig(raw.jump)
  if (authMode === 'key') {
    if (typeof privateKey !== 'string' || !isOpenSshPrivateKey(privateKey)) {
      throw new Error('Invalid terminal smoke config: key mode private key')
    }
    if (password !== null || certificate !== null) {
      throw new Error('Invalid terminal smoke config: key mode extras')
    }
  } else if (authMode === 'password') {
    if (typeof password !== 'string' || hasControlCharacters(password)) {
      throw new Error('Invalid terminal smoke config: password mode password')
    }
    if (privateKey !== null || certificate !== null || jump !== null) {
      throw new Error('Invalid terminal smoke config: password mode extras')
    }
  } else if (authMode === 'agent') {
    if (
      privateKey !== null ||
      password !== null ||
      certificate !== null ||
      jump !== null
    ) {
      throw new Error('Invalid terminal smoke config: agent mode extras')
    }
  } else if (authMode === 'cert') {
    if (typeof privateKey !== 'string' || !isOpenSshPrivateKey(privateKey)) {
      throw new Error('Invalid terminal smoke config: cert mode private key')
    }
    if (typeof certificate !== 'string' || !isOpenSshCertificate(certificate)) {
      throw new Error('Invalid terminal smoke config: cert mode certificate')
    }
    if (password !== null && hasControlCharacters(password)) {
      throw new Error('Invalid terminal smoke config: cert mode passphrase')
    }
    if (jump !== null) {
      throw new Error('Invalid terminal smoke config: cert mode jump')
    }
  }
  if (jump !== null && authMode !== 'key') {
    throw new Error('Invalid terminal smoke config: jump requires key mode')
  }
  return {
    host: raw.host as string,
    port: raw.port as number,
    username: raw.username as string,
    expectedHostKey: raw.expectedHostKey as string,
    authMode: authMode as TerminalSmokeAuthMode,
    privateKey,
    password,
    certificate,
    jump,
  }
}
