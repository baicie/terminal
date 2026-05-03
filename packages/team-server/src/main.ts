import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory as NestFactoryAsync } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactoryAsync.create(AppModule)

  app.setGlobalPrefix('api/v1')

  const corsOrigins = process.env.CORS_ORIGINS?.split(',').filter(Boolean) ?? ['*']
  app.enableCors({
    origin: corsOrigins[0] === '*' ? '*' : corsOrigins,
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

  const config = new DocumentBuilder()
    .setTitle('Team Server API')
    .setDescription('API for Terminal Team Collaboration — secure, real-time team sync for SSH/SFTP environments')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'Authorization', in: 'header' }, 'API_KEY')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)

  const port = process.env.PORT || 3000
  await app.listen(port)
  console.log(`🚀 Team Server running on http://localhost:${port}`)
  console.log(`📚 API Docs: http://localhost:${port}/api/docs`)
  console.log(`🔒 Sync endpoints: /api/v1/sync/* (requires API key)`)
}

bootstrap()
