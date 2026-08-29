import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { nanoid } from 'nanoid'
import { PrismaService } from '../prisma.service'
import {
  registrationTokenMatches,
  resolveRegistrationMode,
} from '../server-config'
import {
  hashApiToken,
  isEncodedApiTokenHash,
  legacyHashApiToken,
} from './token-hash'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async register(
    userId: string,
    registrationToken?: string,
  ): Promise<{ userId: string; token: string }> {
    this.assertRegistrationAllowed(registrationToken)
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    })
    if (existingUser) {
      throw new ConflictException(
        'User is already registered; provide an existing API token',
      )
    }

    const token = nanoid(32)
    await this.prisma.$transaction(async transaction => {
      const user = await transaction.user.create({
        data: { id: userId },
      })
      await transaction.apiToken.create({
        data: {
          userId: user.id,
          name: 'Default Token',
          token: hashApiToken(token),
        },
      })
    })

    return { userId, token }
  }

  private assertRegistrationAllowed(providedToken: string | undefined): void {
    const mode = resolveRegistrationMode(
      this.config.get<string>('REGISTRATION_MODE'),
      this.config.get<string>('NODE_ENV'),
    )
    const tokenAllowed =
      mode === 'token' &&
      registrationTokenMatches(
        this.config.get<string>('REGISTRATION_TOKEN'),
        providedToken,
      )
    if (mode !== 'open' && !tokenAllowed) {
      throw new ForbiddenException('Registration is not available')
    }
  }

  async createToken(userId: string, name?: string): Promise<{ token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    })
    if (!user) throw new UnauthorizedException('User not found')

    const token = nanoid(32)
    await this.prisma.apiToken.create({
      data: {
        userId,
        name: name || 'Default Token',
        token: hashApiToken(token),
      },
    })
    return { token }
  }

  async validateToken(token: string): Promise<{ userId: string }> {
    const tokenRecord = await this.findTokenRecord(token)
    if (!tokenRecord) throw new UnauthorizedException('Invalid token')
    if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Token expired')
    }
    return { userId: tokenRecord.userId }
  }

  async revokeToken(token: string, userId: string): Promise<void> {
    const tokenRecord = await this.findTokenRecord(token)

    if (!tokenRecord || tokenRecord.userId !== userId) {
      throw new UnauthorizedException('Invalid token')
    }
    await this.prisma.apiToken.delete({ where: { id: tokenRecord.id } })
  }

  async revokeTokenById(tokenId: string, userId: string): Promise<void> {
    const result = await this.prisma.apiToken.deleteMany({
      where: { id: tokenId, userId },
    })
    if (result.count === 0) throw new UnauthorizedException('Token not found')
  }

  async listTokens(userId: string): Promise<
    {
      id: string
      name: string | null
      createdAt: Date
      expiresAt: Date | null
    }[]
  > {
    return this.prisma.apiToken.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        expiresAt: true,
      },
    })
  }

  private async findTokenRecord(token: string) {
    const tokenHash = hashApiToken(token)
    const currentRecord = await this.prisma.apiToken.findUnique({
      where: { token: tokenHash },
    })
    if (currentRecord) return currentRecord

    // A stored digest is never a bearer credential, even during migration.
    if (isEncodedApiTokenHash(token)) return null

    const legacyDigestRecord = await this.prisma.apiToken.findUnique({
      where: { token: legacyHashApiToken(token) },
    })
    const legacyPlaintextRecord = legacyDigestRecord
      ? null
      : await this.prisma.apiToken.findUnique({ where: { token } })
    const legacyRecord = legacyDigestRecord ?? legacyPlaintextRecord
    if (!legacyRecord) return null

    await this.prisma.apiToken.update({
      where: { id: legacyRecord.id },
      data: { token: tokenHash },
    })
    return legacyRecord
  }
}
