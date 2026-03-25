import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { nanoid } from 'nanoid'

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  /**
   * Register a new user (creates if not exists)
   * Returns an API token for immediate use
   */
  async register(userId: string, name?: string): Promise<{ userId: string; token?: string }> {
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          id: userId,
          ...(name && { name }),
        },
      })
    }

    // Generate a token for immediate use
    const token = nanoid(32)
    await this.prisma.apiToken.create({
      data: {
        userId: user.id,
        name: 'Default Token',
        token,
      },
    })

    return { userId: user.id, token }
  }

  /**
   * Create a new API token for a user
   */
  async createToken(userId: string, name?: string): Promise<{ token: string }> {
    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    // Generate token
    const token = nanoid(32)

    // Create token record
    await this.prisma.apiToken.create({
      data: {
        userId,
        name: name || 'Default Token',
        token,
      },
    })

    return { token }
  }

  /**
   * Validate API token and return user
   */
  async validateToken(token: string): Promise<{ userId: string }> {
    const tokenRecord = await this.prisma.apiToken.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid token')
    }

    // Check expiration
    if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Token expired')
    }

    return { userId: tokenRecord.userId }
  }

  /**
   * Revoke an API token
   */
  async revokeToken(token: string): Promise<void> {
    await this.prisma.apiToken.delete({
      where: { token },
    })
  }

  /**
   * List all tokens for a user
   */
  async listTokens(userId: string): Promise<{ id: string; name: string; createdAt: Date; expiresAt: Date | null }[]> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        expiresAt: true,
      },
    })
    return tokens
  }
}
