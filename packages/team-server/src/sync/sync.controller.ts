import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
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
  @ApiOperation({ summary: 'Get all changes since timestamp (incremental sync)' })
  async getChanges(@Query('since') since: string, @ApiKeyAuth() userId: string) {
    return this.syncService.getChanges(userId, since ? Number.parseInt(since, 10) : undefined)
  }

  @Post()
  @ApiOperation({ summary: 'Push local changes to server with conflict detection' })
  async pushChanges(
    @Body()
    body: {
      shares?: Array<{
        id: string
        teamId: string
        type: string
        data: unknown
        encryptedData?: string
        isSensitive?: boolean
        permission: string
        baseVersion?: number
      }>
      deleteShares?: string[]
    },
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.pushChanges(userId, body)
  }

  @Post('conflicts/check')
  @ApiOperation({ summary: 'Check for sync conflicts' })
  async checkConflicts(
    @Body()
    body: {
      items: Array<{
        id: string
        updatedAt: number
        type: 'HOST' | 'SNIPPET_PACKAGE'
      }>
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
      clientData?: {
        data: unknown
        encryptedData?: string
        isSensitive?: boolean
        permission?: string
      }
    },
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.resolveConflict(
      body.shareId,
      userId,
      body.resolution,
      body.clientData,
    )
  }

  // ==================== Offline Queue ====================

  @Get('queue')
  @ApiOperation({ summary: 'Get all pending offline operations' })
  async getPendingOperations(@ApiKeyAuth() userId: string) {
    return this.syncService.getPendingOperations(userId)
  }

  @Post('queue/process')
  @ApiOperation({ summary: 'Process pending offline operations' })
  async processOfflineQueue(@ApiKeyAuth() userId: string) {
    return this.syncService.processOfflineQueue(userId)
  }

  @Post('queue/enqueue')
  @ApiOperation({ summary: 'Add operation to offline queue' })
  async enqueueOperation(
    @Body()
    body: {
      teamId: string
      operation: 'CREATE' | 'UPDATE' | 'DELETE'
      shareType: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE'
      shareId: string
      data?: unknown
    },
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.enqueueOfflineOperation(
      userId,
      body.teamId,
      body.operation,
      body.shareType,
      body.shareId,
      body.data,
    )
  }

  @Delete('queue/:id')
  @ApiOperation({ summary: 'Remove an operation from the queue' })
  async removeFromQueue(@Param('id') id: string, @ApiKeyAuth() userId: string) {
    await this.syncService.removeFromQueue(id, userId)
    return { success: true }
  }

  @Delete('queue/team/:teamId')
  @ApiOperation({ summary: 'Clear all operations for a team' })
  async clearTeamQueue(@Param('teamId') teamId: string, @ApiKeyAuth() userId: string) {
    await this.syncService.clearTeamQueue(userId, teamId)
    return { success: true }
  }
}
