const DEVELOPMENT_CORS_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
]

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
