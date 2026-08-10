import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { IdentifierPipe } from '../http-validation'
import { AuditQueryDto } from './audit.dto'
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
    @Param('teamId', IdentifierPipe) teamId: string,
    @Query() query: AuditQueryDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.auditService.findAll(teamId, userId, query.limit ?? 100)
  }
}
