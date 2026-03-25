import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { SharesService } from './shares.service'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { ApiKeyAuth } from '../auth/api-key-auth.decorator'

@ApiTags('shares')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller('teams/:teamId/shares')
export class SharesController {
  constructor(private sharesService: SharesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all shares for team' })
  async findAll(@Param('teamId') teamId: string, @ApiKeyAuth() userId: string) {
    return this.sharesService.findAll(teamId, userId)
  }

  @Post()
  @ApiOperation({ summary: 'Create a new share' })
  async create(
    @Param('teamId') teamId: string,
    @Body() body: { type: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE'; data: any; permission: 'READONLY' | 'READWRITE' },
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.create(teamId, userId, body)
  }

  @Get(':shareId')
  @ApiOperation({ summary: 'Get share by ID' })
  async findOne(
    @Param('teamId') teamId: string,
    @Param('shareId') shareId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.findOne(teamId, shareId, userId)
  }

  @Put(':shareId')
  @ApiOperation({ summary: 'Update share permission' })
  async update(
    @Param('teamId') teamId: string,
    @Param('shareId') shareId: string,
    @Body() body: { permission: 'READONLY' | 'READWRITE' },
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.update(teamId, shareId, userId, body.permission)
  }

  @Delete(':shareId')
  @ApiOperation({ summary: 'Delete share' })
  async delete(
    @Param('teamId') teamId: string,
    @Param('shareId') shareId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.delete(teamId, shareId, userId)
  }
}
