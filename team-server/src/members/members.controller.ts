import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { MembersService } from './members.service'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'

@ApiTags('members')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller('teams/:teamId/members')
export class MembersController {
  constructor(private membersService: MembersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all team members' })
  async findAll(@Param('teamId') teamId: string, @ApiKeyAuth() userId: string) {
    return this.membersService.findAll(teamId, userId)
  }

  @Post()
  @ApiOperation({ summary: 'Add a member to team' })
  async addMember(
    @Param('teamId') teamId: string,
    @Body() body: { userId: string; userName?: string; userEmail?: string; role?: 'ADMIN' | 'MEMBER' },
    @ApiKeyAuth() userId: string,
  ) {
    return this.membersService.addMember(teamId, userId, body.userId, body.userName, body.userEmail, body.role)
  }

  @Put(':memberId')
  @ApiOperation({ summary: 'Update member role' })
  async updateRole(
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
    @Body() body: { role: 'ADMIN' | 'MEMBER' },
    @ApiKeyAuth() userId: string,
  ) {
    return this.membersService.updateRole(teamId, userId, memberId, body.role)
  }

  @Delete(':memberId')
  @ApiOperation({ summary: 'Remove member from team' })
  async removeMember(
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.membersService.removeMember(teamId, userId, memberId)
  }
}
