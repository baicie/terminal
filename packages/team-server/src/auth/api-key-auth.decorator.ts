import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/**
 * Custom decorator to get the authenticated user ID from the API key guard
 */
export const ApiKeyAuth = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest()
    return request.user?.userId
  },
)
