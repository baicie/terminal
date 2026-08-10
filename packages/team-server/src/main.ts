import type { NestExpressApplication } from '@nestjs/platform-express'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { isSwaggerEnabled, resolveCorsOrigins } from './server-config'

const REQUEST_BODY_LIMIT = '1mb'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  })
  const logger = new Logger('Bootstrap')
  const nodeEnvironment = process.env.NODE_ENV

  app.enableShutdownHooks()
  app.setGlobalPrefix('api/v1')
  app.use(
    helmet(
      nodeEnvironment === 'production'
        ? {}
        : {
            contentSecurityPolicy: false,
            strictTransportSecurity: false,
          },
    ),
  )
  app.useBodyParser('json', { limit: REQUEST_BODY_LIMIT })
  app.useBodyParser('urlencoded', {
    extended: true,
    limit: REQUEST_BODY_LIMIT,
  })

  const corsOrigins = resolveCorsOrigins(
    process.env.CORS_ORIGINS,
    nodeEnvironment,
  )
  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400,
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  const swaggerEnabled = isSwaggerEnabled(
    process.env.SWAGGER_ENABLED,
    nodeEnvironment,
  )
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Team Server API')
      .setDescription(
        'API for Terminal Team Collaboration - secure team sync for SSH/SFTP environments',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'API token' },
        'API_KEY',
      )
      .build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
  }

  const port = process.env.PORT || 3000
  await app.listen(port)
  logger.log(`Team Server running on http://localhost:${port}`)
  if (swaggerEnabled) logger.log(`API Docs: http://localhost:${port}/api/docs`)
  logger.log('Sync endpoints: /api/v1/sync/* (requires API key)')
}

bootstrap()
