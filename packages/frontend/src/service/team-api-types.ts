export interface ApiResponse<T> {
  data?: T
  error?: string
}

export interface ApiError {
  statusCode: number
  message: string
}

/**
 * The wire form of an operation whose HTTP 200 can still mean "refused".
 *
 * `ApiResponse.error` only ever describes transport and HTTP status: a 200 with
 * `{ success: false }` arrives as `data`, so checking `error` alone treated a
 * refused conflict resolution as a success and dropped the conflict (P9.2-3).
 */
export interface ApiOperationResult {
  success: boolean
  error?: string
}

/**
 * Why an operation is considered failed; kept explicit so callers cannot guess.
 *
 * `http` carries the status because 404 (gone), 403 (no longer allowed) and 5xx
 * (temporarily broken) call for three different recoveries, and a message string
 * is not something a caller may branch on.
 */
export type ApiFailureReason
  = | 'not-configured'
    | 'http'
    | 'network'
    | 'timeout'
    | 'invalid-json'
    | 'missing-data'
    | 'operation-failed'

export type ApiOutcome<T>
  = | { ok: true, data: T }
    | { ok: false, reason: 'http', status: number, message: string }
    | { ok: false, reason: Exclude<ApiFailureReason, 'http'>, message: string }
