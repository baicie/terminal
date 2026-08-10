import { TeamApiBase } from './team-api-base'
import type { ApiResponse } from './team-api-types'

export class TeamApiAuth extends TeamApiBase {
  async register(
    userId: string,
    name?: string,
  ): Promise<ApiResponse<{ userId: string; token: string }>> {
    return this.publicRequest('POST', '/auth/register', { userId, name })
  }

  async createToken(
    name: string,
  ): Promise<ApiResponse<{ id: string; token: string; name: string }>> {
    return this.request('POST', '/auth/tokens', { name })
  }

  async listTokens(): Promise<
    ApiResponse<Array<{ id: string; name: string; createdAt: string }>>
  > {
    return this.request('GET', '/auth/tokens')
  }

  async revokeToken(tokenId: string): Promise<ApiResponse<void>> {
    return this.request('DELETE', `/auth/tokens/${tokenId}`)
  }
}
