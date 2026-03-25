import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { PrismaService } from '../prisma.service'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  async check() {
    try {
      // Check database connection
      await this.prisma.$queryRaw`SELECT 1`
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
      }
    } catch {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      }
    }
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  liveness() {
    return { status: 'ok' }
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'ready' }
    } catch {
      return { status: 'not ready', reason: 'database connection failed' }
    }
  }
}
