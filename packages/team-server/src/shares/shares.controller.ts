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
import { CreateShareDto, UpdateShareDto } from './shares.dto'
import { SharesService } from './shares.service'

@ApiTags('shares')
@ApiBearerAuth('API_KEY')
@UseGuards(ApiKeyGuard)
@Controller('teams/:teamId/shares')
export class SharesController {
  constructor(private sharesService: SharesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all shares for team' })
  async findAll(
    @Param('teamId', IdentifierPipe) teamId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.findAll(teamId, userId)
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a new share (supports encrypted data for sensitive shares)',
  })
  async create(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Body() body: CreateShareDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.create(teamId, userId, body)
  }

  @Get(':shareId')
  @ApiOperation({ summary: 'Get share by ID' })
  async findOne(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Param('shareId', IdentifierPipe) shareId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.findOne(teamId, shareId, userId)
  }

  @Put(':shareId')
  @ApiOperation({ summary: 'Update share (including encrypted data)' })
  async update(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Param('shareId', IdentifierPipe) shareId: string,
    @Body() body: UpdateShareDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.update(teamId, shareId, userId, body)
  }

  @Delete(':shareId')
  @ApiOperation({ summary: 'Delete share' })
  async delete(
    @Param('teamId', IdentifierPipe) teamId: string,
    @Param('shareId', IdentifierPipe) shareId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.sharesService.delete(teamId, shareId, userId)
  }
}
