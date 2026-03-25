import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { InvitesService } from './invites.service'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'

@ApiTags('invites')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller()
export class InvitesController {
  constructor(private invitesService: InvitesService) {}

  @Post('teams/:teamId/invites')
  @ApiOperation({ summary: 'Create an invite' })
  async create(
    @Param('teamId') teamId: string,
    @Body() body: { type: 'LINK' | 'CODE' | 'EMAIL'; email?: string; role?: 'ADMIN' | 'MEMBER' },
    @ApiKeyAuth() userId: string,
  ) {
    return this.invitesService.create(teamId, userId, body)
  }

  @Get('teams/:teamId/invites')
  @ApiOperation({ summary: 'Get all invites for team' })
  async findAll(@Param('teamId') teamId: string, @ApiKeyAuth() userId: string) {
    return this.invitesService.findAll(teamId, userId)
  }

  @Delete('teams/:teamId/invites/:inviteId')
  @ApiOperation({ summary: 'Delete an invite' })
  async delete(
    @Param('teamId') teamId: string,
    @Param('inviteId') inviteId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.invitesService.delete(teamId, inviteId, userId)
  }

  @Post('invites/join')
  @ApiOperation({ summary: 'Join team by code' })
  async joinByCode(
    @Body() body: { code: string; userName?: string },
    @ApiKeyAuth() userId: string,
  ) {
    return this.invitesService.joinByCode(body.code, userId, body.userName)
  }

  @Get('invites/link/:linkToken')
  @ApiOperation({ summary: 'Get invite info by link token' })
  async getByLink(@Param('linkToken') linkToken: string) {
    const result = await this.invitesService.getInviteByCode(linkToken)
    if (!result) return null
    return { teamName: result.team?.name, role: result.invite.role }
  }

  @Post('invites/link/:linkToken/join')
  @ApiOperation({ summary: 'Join team by link' })
  async joinByLink(
    @Param('linkToken') linkToken: string,
    @Body() body: { userName?: string },
    @ApiKeyAuth() userId: string,
  ) {
    return this.invitesService.joinByLink(linkToken, userId, body.userName)
  }
}
