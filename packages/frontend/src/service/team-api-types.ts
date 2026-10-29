export interface ApiResponse<T> {
  data?: T
  error?: string
}

export interface ApiError {
  statusCode: number
  message: string
}
