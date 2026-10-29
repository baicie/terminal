import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { IdentifierPipe } from '../http-validation'
import { AddMemberDto, UpdateMemberRoleDto } from './members.dto'
import { MembersService } from './members.service'

@ApiTags('members')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller('teams/:teamId/members')
export class MembersController {
  constructor(private membersService: MembersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all team members' })
  async findAll(
    @Param('teamId', IdentifierPipe) teamId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.membersService.findAll(teamId, userId)
  }

  @Post()
  @ApiOperation({ summary: 'Add a member to team' })
  async addMember(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Body() body: AddMemberDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.membersService.addMember(
      teamId,
      userId,
      body.userId,
      body.userName,
      body.userEmail,
      body.role,
    )
  }

  @Put(':memberId')
  @ApiOperation({ summary: 'Update member role' })
  async updateRole(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Param('memberId', IdentifierPipe) memberId: string,
    @Body() body: UpdateMemberRoleDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.membersService.updateRole(teamId, userId, memberId, body.role)
  }

  @Delete(':memberId')
  @ApiOperation({ summary: 'Remove member from team' })
  async removeMember(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Param('memberId', IdentifierPipe) memberId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.membersService.removeMember(teamId, userId, memberId)
  }
}
