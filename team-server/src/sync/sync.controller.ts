import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { SyncService } from './sync.service'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'

@ApiTags('sync')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller('sync')
export class SyncController {
  constructor(private syncService: SyncService) {}

  @Get()
  @ApiOperation({ summary: 'Get all changes since timestamp' })
  async getChanges(
    @Query('since') since: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.getChanges(userId, since ? parseInt(since, 10) : undefined)
  }

  @Post()
  @ApiOperation({ summary: 'Push local changes to server' })
  async pushChanges(
    @Body() body: any,
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.pushChanges(userId, body)
  }
}
