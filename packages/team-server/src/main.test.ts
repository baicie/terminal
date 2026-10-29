import type { NestExpressApplication } from '@nestjs/platform-express'
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createApplication } = vi.hoisted(() => ({
  createApplication: vi.fn(),
}))

vi.mock('@nestjs/core', () => ({
  NestFactory: { create: createApplication },
}))

vi.mock('@nestjs/swagger', () => ({
  DocumentBuilder: vi.fn(),
  SwaggerModule: {
    createDocument: vi.fn(),
    setup: vi.fn(),
  },
}))

vi.mock('./app.module', () => ({ AppModule: class AppModule {} }))

function createApplicationMock() {
  return {
    enableCors: vi.fn(),
    enableShutdownHooks: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    setGlobalPrefix: vi.fn(),
    use: vi.fn(),
    useBodyParser: vi.fn(),
    useGlobalPipes: vi.fn(),
  }
}

describe('Team Server bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CORS_ORIGINS', 'https://terminal.example')
    vi.stubEnv('SWAGGER_ENABLED', 'false')
    vi.stubEnv('PORT', '3100')
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('enables graceful shutdown and enforces explicit request body limits', async () => {
    const app = createApplicationMock()
    createApplication.mockResolvedValue(
      app as unknown as NestExpressApplication,
    )

    await import('./main')
    await vi.waitFor(() => expect(app.listen).toHaveBeenCalledWith('3100'))

    expect(createApplication).toHaveBeenCalledWith(expect.any(Function), {
      bodyParser: false,
    })
    expect(app.enableShutdownHooks).toHaveBeenCalledOnce()
    expect(app.useBodyParser).toHaveBeenNthCalledWith(1, 'json', {
      limit: '1mb',
    })
    expect(app.useBodyParser).toHaveBeenNthCalledWith(2, 'urlencoded', {
      extended: true,
      limit: '1mb',
    })
  })
})
