import { Controller, Post, Get, Delete, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { ApiKeyAuth } from './api-key-auth.decorator'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register or get user ID' })
  @ApiResponse({ status: 201, description: 'User registered' })
  async register(@Body() body: { userId: string; name?: string }) {
    return this.authService.register(body.userId, body.name)
  }

  @Post('tokens')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('API_KEY')
  @ApiOperation({ summary: 'Create a new API token' })
  @ApiResponse({ status: 201, description: 'Token created' })
  async createToken(
    @Body() body: { name?: string },
    @ApiKeyAuth() userId: string,
  ) {
    return this.authService.createToken(userId, body.name)
  }

  @Get('tokens')
  @ApiBearerAuth('API_KEY')
  @ApiOperation({ summary: 'List all API tokens' })
  @ApiResponse({ status: 200, description: 'Tokens list' })
  async listTokens(@ApiKeyAuth() userId: string) {
    return this.authService.listTokens(userId)
  }

  @Delete('tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('API_KEY')
  @ApiOperation({ summary: 'Revoke current API token' })
  @ApiResponse({ status: 204, description: 'Token revoked' })
  async revokeToken(@ApiKeyAuth() userId: string, @Headers('authorization') auth: string) {
    const token = auth.replace('Bearer ', '')
    return this.authService.revokeToken(token)
  }
}
