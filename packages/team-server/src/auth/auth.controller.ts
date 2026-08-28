import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { IdentifierPipe } from '../http-validation'
import { ApiKeyAuth } from './api-key-auth.decorator'
import { ApiKeyGuard } from './api-key.guard'
import { CreateTokenDto, RegisterDto } from './auth.dto'
import { AuthService } from './auth.service'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register or get user ID' })
  @ApiHeader({
    name: 'X-Registration-Token',
    required: false,
    description: 'Required when REGISTRATION_MODE=token',
  })
  @ApiResponse({ status: 201, description: 'User registered' })
  async register(
    @Body() body: RegisterDto,
    @Headers('x-registration-token') registrationToken?: string,
  ) {
    return this.authService.register(body.userId, registrationToken)
  }

  @Post('tokens')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('API_KEY')
  @ApiOperation({ summary: 'Create a new API token' })
  @ApiResponse({ status: 201, description: 'Token created' })
  async createToken(
    @Body() body: CreateTokenDto,
    @ApiKeyAuth() userId: string,
  ) {
    return this.authService.createToken(userId, body.name)
  }

  @Get('tokens')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth('API_KEY')
  @ApiOperation({ summary: 'List all API tokens' })
  @ApiResponse({ status: 200, description: 'Tokens list' })
  async listTokens(@ApiKeyAuth() userId: string) {
    return this.authService.listTokens(userId)
  }

  @Delete('tokens')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('API_KEY')
  @ApiOperation({ summary: 'Revoke current API token' })
  @ApiResponse({ status: 204, description: 'Token revoked' })
  async revokeToken(
    @ApiKeyAuth() userId: string,
    @Headers('authorization') auth: string,
  ) {
    const token = auth.replace('Bearer ', '')
    return this.authService.revokeToken(token, userId)
  }

  @Delete('tokens/:tokenId')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('API_KEY')
  @ApiOperation({ summary: 'Revoke an API token by ID' })
  @ApiResponse({ status: 204, description: 'Token revoked' })
  async revokeTokenById(
    @Param('tokenId', IdentifierPipe) tokenId: string,
    @ApiKeyAuth() userId: string,
  ) {
    return this.authService.revokeTokenById(tokenId, userId)
  }
}
