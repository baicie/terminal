import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { SyncService } from './sync.service'

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
    return this.syncService.getChanges(
      userId,
      since ? Number.parseInt(since, 10) : undefined,
    )
  }

  @Post()
  @ApiOperation({ summary: 'Push local changes to server' })
  async pushChanges(@Body() body: any, @ApiKeyAuth() userId: string) {
    return this.syncService.pushChanges(userId, body)
  }

  @Post('conflicts/check')
  @ApiOperation({ summary: 'Check for sync conflicts' })
  async checkConflicts(
    @Body()
    body: {
      items: Array<{ id: string; updatedAt: number; type: 'HOST' | 'SNIPPET_PACKAGE' }>
    },
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.checkConflicts(userId, body.items)
  }

  @Post('conflicts/resolve')
  @ApiOperation({ summary: 'Resolve a sync conflict' })
  async resolveConflict(
    @Body()
    body: {
      shareId: string
      resolution: 'LOCAL' | 'REMOTE'
    },
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.resolveConflict(body.shareId, userId, body.resolution)
  }
}
