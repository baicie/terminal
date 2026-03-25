import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { TeamsService } from './teams.service'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'

@ApiTags('teams')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller('teams')
export class TeamsController {
  constructor(private teamsService: TeamsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new team' })
  async create(@Body() body: { name: string }, @ApiKeyAuth() userId: string) {
    return this.teamsService.create(userId, body.name)
  }

  @Get()
  @ApiOperation({ summary: 'Get all teams for current user' })
  async findAll(@ApiKeyAuth() userId: string) {
    return this.teamsService.findAll(userId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get team by ID' })
  async findOne(@Param('id') id: string, @ApiKeyAuth() userId: string) {
    return this.teamsService.findOne(id, userId)
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update team' })
  async update(
    @Param('id') id: string,
    @Body() body: { name: string },
    @ApiKeyAuth() userId: string,
  ) {
    return this.teamsService.update(id, userId, body.name)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete team (owner only)' })
  async delete(@Param('id') id: string, @ApiKeyAuth() userId: string) {
    return this.teamsService.delete(id, userId)
  }
}
