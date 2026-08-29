import { createHash, timingSafeEqual } from 'node:crypto'

const DEVELOPMENT_CORS_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
]

const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const
const REGISTRATION_MODES = ['closed', 'token', 'open'] as const

export type RegistrationMode = (typeof REGISTRATION_MODES)[number]

export function resolveRegistrationMode(
  configuredValue: string | undefined,
  nodeEnvironment: string | undefined,
): RegistrationMode {
  const normalized = configuredValue?.trim().toLowerCase()
  if (!normalized) return nodeEnvironment === 'production' ? 'closed' : 'open'
  if (REGISTRATION_MODES.includes(normalized as RegistrationMode)) {
    return normalized as RegistrationMode
  }
  throw new Error('REGISTRATION_MODE must be closed, token, or open')
}

export function registrationTokenMatches(
  expectedToken: string | undefined,
  providedToken: string | undefined,
): boolean {
  const digest = (value: string | undefined) =>
    createHash('sha256').update(value ?? '', 'utf8').digest()
  const matches = timingSafeEqual(digest(expectedToken), digest(providedToken))
  return Boolean(
    expectedToken &&
      expectedToken.length >= 32 &&
      providedToken &&
      matches,
  )
}

export function validateServerEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnvironment = environment.NODE_ENV
  if (
    typeof nodeEnvironment !== 'string' ||
    !NODE_ENVIRONMENTS.includes(
      nodeEnvironment as (typeof NODE_ENVIRONMENTS)[number],
    )
  ) {
    throw new Error('NODE_ENV must be development, test, or production')
  }

  const registrationMode = resolveRegistrationMode(
    typeof environment.REGISTRATION_MODE === 'string'
      ? environment.REGISTRATION_MODE
      : undefined,
    nodeEnvironment,
  )
  const registrationToken =
    typeof environment.REGISTRATION_TOKEN === 'string'
      ? environment.REGISTRATION_TOKEN.trim()
      : ''
  if (registrationMode === 'token' && registrationToken.length < 32) {
    throw new Error(
      'REGISTRATION_TOKEN must contain at least 32 characters in token mode',
    )
  }

  return {
    ...environment,
    NODE_ENV: nodeEnvironment,
    REGISTRATION_MODE: registrationMode,
    REGISTRATION_TOKEN: registrationToken,
  }
}

export function resolveCorsOrigins(
  configuredOrigins: string | undefined,
  nodeEnvironment: string | undefined,
): string[] {
  const origins = configuredOrigins
    ?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

  if (!origins?.length) {
    if (nodeEnvironment === 'production') {
      throw new Error('CORS_ORIGINS must be configured in production')
    }
    return [...DEVELOPMENT_CORS_ORIGINS]
  }

  if (origins.includes('*')) {
    throw new Error('CORS wildcard is not allowed with credentialed requests')
  }
  return origins
}

export function isSwaggerEnabled(
  configuredValue: string | undefined,
  nodeEnvironment: string | undefined,
): boolean {
  if (configuredValue === undefined || configuredValue.trim() === '') {
    return nodeEnvironment !== 'production'
  }

  const normalizedValue = configuredValue.trim().toLowerCase()
  if (normalizedValue === 'true') return true
  if (normalizedValue === 'false') return false

  throw new Error('SWAGGER_ENABLED must be either true or false')
}
