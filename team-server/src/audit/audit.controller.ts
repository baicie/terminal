import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { AuditService } from './audit.service'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'

@ApiTags('audit')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller('teams/:teamId/audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Get audit logs for team' })
  async findAll(
    @Param('teamId') teamId: string,
    @Query('limit') limit: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.auditService.findAll(teamId, userId, limit ? parseInt(limit, 10) : 100)
  }
}
