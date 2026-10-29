import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { IdentifierPipe } from '../http-validation'
import {
  ConflictCheckDto,
  EnqueueOperationDto,
  PushChangesDto,
  ResolveConflictDto,
  SyncQueryDto,
} from './sync.dto'
import { SyncService } from './sync.service'

@ApiTags('sync')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller('sync')
export class SyncController {
  constructor(private syncService: SyncService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all changes since timestamp (incremental sync)',
  })
  async getChanges(@Query() query: SyncQueryDto, @ApiKeyAuth() userId: string) {
    return this.syncService.getChanges(userId, query.since)
  }

  @Post()
  @ApiOperation({
    summary: 'Push local changes to server with conflict detection',
  })
  async pushChanges(
    @Body() body: PushChangesDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.pushChanges(userId, body)
  }

  @Post('conflicts/check')
  @ApiOperation({ summary: 'Check for sync conflicts' })
  async checkConflicts(
    @Body() body: ConflictCheckDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.syncService.checkConflicts(userId, body.items)
  }

  @Post('conflicts/resolve')
  @ApiOperation({ summary: 'Resolve a sync conflict' })
  async resolveConflict(
    @Body() body: ResolveConflictDto,
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
    @Body() body: EnqueueOperationDto,
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
  async removeFromQueue(
    @Param('id', IdentifierPipe) id: string,
    @ApiKeyAuth() userId: string,
  ) {
    await this.syncService.removeFromQueue(id, userId)
    return { success: true }
  }

  @Delete('queue/team/:teamId')
  @ApiOperation({ summary: 'Clear all operations for a team' })
  async clearTeamQueue(
    @Param('teamId', IdentifierPipe) teamId: string,
    @ApiKeyAuth() userId: string,
  ) {
    await this.syncService.clearTeamQueue(userId, teamId)
    return { success: true }
  }
}
