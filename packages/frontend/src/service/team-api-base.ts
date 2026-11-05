import type {
  ApiError,
  ApiOperationResult,
  ApiOutcome,
  ApiResponse,
} from './team-api-types'

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

  /**
   * A request that must be judged by what the *server* decided, not by the HTTP
   * status alone. Every way an operation can fail is enumerated here, so a caller
   * cannot mistake one failure mode for another: an unreachable server, an
   * unparseable body, a missing body, and a body that says `success: false` are
   * all failures, and none of them may be read as "done" (P9.2-3).
   */
  protected async operation<T>(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<ApiOutcome<T>> {
    if (!this.isConfigured()) {
      return { ok: false, reason: 'not-configured', message: 'API not configured' }
    }
    const response = await this.performOutcome<T>(method, path, body, true)
    if (!response.ok) return response
    return { ok: true, data: response.data }
  }

  /**
   * A read whose failure has to stay distinguishable, so a caller can tell "the
   * resource is gone" (404) from "you may no longer read it" (403) from "the
   * request itself failed" (anything else).
   */
  protected async readOperation<T>(path: string): Promise<ApiOutcome<T>> {
    if (!this.isConfigured()) {
      return { ok: false, reason: 'not-configured', message: 'API not configured' }
    }
    const response = await this.performOutcome<T>('GET', path, undefined, true)
    if (!response.ok) return response
    return { ok: true, data: response.data }
  }

  /**
   * Same contract as `operation`, for endpoints that answer with a success flag.
   * A `data` object that is absent or says `success: false` is a failure: the
   * server refused the write, and the local state has not converged.
   */
  protected async operationResult(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<ApiOutcome<ApiOperationResult>> {
    const outcome = await this.operation<ApiOperationResult>(method, path, body)
    if (!outcome.ok) return outcome
    const value = outcome.data
    if (value === null || typeof value !== 'object' || typeof value.success !== 'boolean') {
      return {
        ok: false,
        reason: 'missing-data',
        message: 'Server returned no operation result',
      }
    }
    if (value.success !== true) {
      return {
        ok: false,
        reason: 'operation-failed',
        message: value.error ?? 'Server refused the operation',
      }
    }
    return { ok: true, data: value }
  }

  private async performRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    authenticated: boolean,
  ): Promise<ApiResponse<T>> {
    const outcome = await this.performOutcome<T>(method, path, body, authenticated)
    return outcome.ok ? { data: outcome.data } : { error: outcome.message }
  }

  private async performOutcome<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    authenticated: boolean,
  ): Promise<ApiOutcome<T>> {
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
        return {
          ok: false,
          reason: 'http',
          status: response.status,
          message: errorData.message || `HTTP ${response.status}`,
        }
      }
      const text = await response.text()
      if (!text) {
        return { ok: false, reason: 'missing-data', message: 'Empty response body' }
      }
      try {
        return { ok: true, data: JSON.parse(text) as T }
      } catch {
        return {
          ok: false,
          reason: 'invalid-json',
          message: 'Server returned a body that is not JSON',
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          ok: false,
          reason: 'timeout',
          message: `Request timed out after ${TEAM_API_TIMEOUT_MS}ms`,
        }
      }
      return {
        ok: false,
        reason: 'network',
        message: error instanceof Error ? error.message : 'Network error',
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
