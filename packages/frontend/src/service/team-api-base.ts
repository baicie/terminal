import type { ApiError, ApiResponse } from './team-api-types'

/** A hung request is aborted after this long instead of blocking a sync forever. */
export const TEAM_API_TIMEOUT_MS = 15_000

export class TeamApiBase {
  protected endpoint = ''
  protected apiToken = ''
  protected userId = ''

  configure(endpoint: string, apiToken: string, userId: string) {
    this.endpoint = endpoint.replace(/\/$/, '')
    this.apiToken = apiToken
    this.userId = userId
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint && this.apiToken && this.userId)
  }

  protected async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    if (!this.isConfigured()) return { error: 'API not configured' }
    return this.performRequest(method, path, body, true)
  }

  protected async publicRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    if (!this.endpoint) return { error: 'API endpoint not configured' }
    return this.performRequest(method, path, body, false)
  }

  private async performRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    authenticated: boolean,
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEAM_API_TIMEOUT_MS)
    try {
      const response = await fetch(`${this.endpoint}/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(authenticated && { Authorization: `Bearer ${this.apiToken}` }),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (!response.ok) {
        const errorData: ApiError = await response.json().catch(() => ({
          statusCode: response.status,
          message: 'Request failed',
        }))
        return { error: errorData.message || `HTTP ${response.status}` }
      }
      const text = await response.text()
      return { data: text ? JSON.parse(text) : null }
    } catch (error) {
      if (controller.signal.aborted)
        return { error: `Request timed out after ${TEAM_API_TIMEOUT_MS}ms` }
      return { error: error instanceof Error ? error.message : 'Network error' }
    } finally {
      clearTimeout(timer)
    }
  }
}
