import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { AuthService } from './auth.service'

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header')
    }

    const token = authHeader.substring(7)

    try {
      const { userId } = await this.authService.validateToken(token)
      request.user = { userId }
      return true
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error
      throw new UnauthorizedException('Invalid or expired token')
    }
  }
}
