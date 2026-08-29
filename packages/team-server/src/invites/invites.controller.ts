import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { IdentifierPipe } from '../http-validation'
import { CreateInviteDto, JoinByCodeDto, JoinByLinkDto } from './invites.dto'
import { InvitesService } from './invites.service'

@ApiTags('invites')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller()
export class InvitesController {
  constructor(private invitesService: InvitesService) {}

  @Post('teams/:teamId/invites')
  @ApiOperation({ summary: 'Create an invite' })
  async create(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Body()
    body: CreateInviteDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.invitesService.create(teamId, userId, body)
  }

  @Get('teams/:teamId/invites')
  @ApiOperation({ summary: 'Get all invites for team' })
  async findAll(
    @Param('teamId', IdentifierPipe) teamId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.invitesService.findAll(teamId, userId)
  }

  @Delete('teams/:teamId/invites/:inviteId')
  @ApiOperation({ summary: 'Delete an invite' })
  async delete(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Param('inviteId', IdentifierPipe) inviteId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.invitesService.delete(teamId, inviteId, userId)
  }

  @Post('invites/join')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Join team by code' })
  async joinByCode(@Body() body: JoinByCodeDto, @ApiKeyAuth() userId: string) {
    return this.invitesService.joinByCode(body.code, userId, body.userName)
  }

  @Get('invites/link/:linkToken')
  @ApiOperation({ summary: 'Get invite info by link token' })
  async getByLink(@Param('linkToken', IdentifierPipe) linkToken: string) {
    const result = await this.invitesService.getInviteByLink(linkToken)
    if (!result) return null
    return { teamName: result.team?.name, role: result.invite.role }
  }

  @Post('invites/link/:linkToken/join')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Join team by link' })
  async joinByLink(
    @Param('linkToken', IdentifierPipe) linkToken: string,
    @Body() body: JoinByLinkDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.invitesService.joinByLink(linkToken, userId, body.userName)
  }
}
