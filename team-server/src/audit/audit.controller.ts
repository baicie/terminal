import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { AuditService } from './audit.service'

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
    return this.auditService.findAll(
      teamId,
      userId,
      limit ? Number.parseInt(limit, 10) : 100,
    )
  }
}
