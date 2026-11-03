import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { buildShareUpdateData } from '../sync/share-write-data'
import { deleteShareWithAudit } from './share-deletion'
import { resolveCreateSensitivity } from './share-security'
import { toShareSnapshot, toShareSnapshots } from './share-serializer'

@Injectable()
export class SharesService {
  constructor(private prisma: PrismaService) {}

  async findAll(teamId: string, userId: string) {
    await this.checkMembership(teamId, userId)
    const rows = await this.prisma.share.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
    })
    // Every response goes through the same mapping as the sync endpoints: a
    // Prisma row carries a BigInt version, which JSON.stringify refuses to
    // serialise (P9.3.1 P0-2).
    return toShareSnapshots(rows)
  }

  async create(
    teamId: string,
    userId: string,
    data: {
      type: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE'
      data?: unknown
      encryptedData?: string
      isSensitive?: boolean
      permission: 'READONLY' | 'READWRITE'
    },
  ) {
    await this.checkMembership(teamId, userId)
    const isSensitive = resolveCreateSensitivity(
      data.isSensitive,
      data.encryptedData,
    )
    const created = await this.prisma.share.create({
      data: {
        teamId,
        type: data.type,
        ...(isSensitive
          ? { encryptedData: data.encryptedData, data: {}, isSensitive: true }
          : { data: data.data as object }),
        sharedBy: userId,
        permission: data.permission,
        isSensitive,
      },
    })
    return toShareSnapshot(created)
  }

  async findOne(teamId: string, shareId: string, userId: string) {
    await this.checkMembership(teamId, userId)
    const share = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!share) throw new NotFoundException('Share not found')
    return toShareSnapshot(share)
  }

  async update(
    teamId: string,
    shareId: string,
    userId: string,
    data: {
      baseVersion?: number
      permission?: 'READONLY' | 'READWRITE'
      data?: unknown
      encryptedData?: string
      isSensitive?: boolean
    },
  ) {
    await this.checkMembership(teamId, userId)
    const share = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!share) throw new NotFoundException('Share not found')
    const isCreator = share.sharedBy === userId
    if (!isCreator && share.permission !== 'READWRITE') {
      throw new ForbiddenException('Only creator can update share')
    }
    const baseVersion = this.requireBaseVersion(data.baseVersion)

    const written = await this.prisma.share.updateMany({
      where: {
        id: shareId,
        teamId,
        // The version column is written by the database trigger on every
        // update. Comparing it makes the write a true CAS: a caller holding a
        // stale row cannot overwrite a newer edit, even when both writes land
        // in the same millisecond (P9.3.2 A2).
        version: baseVersion,
      },
      data: isCreator
        ? buildShareUpdateData(data, share)
        : buildShareUpdateData(data, share, true, true),
    })
    if (written.count !== 1) {
      throw new ConflictException('Share was modified concurrently')
    }
    const updated = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!updated) throw new NotFoundException('Share not found')
    return toShareSnapshot(updated)
  }

  async delete(teamId: string, shareId: string, userId: string) {
    await this.checkMembership(teamId, userId)
    const share = await this.prisma.share.findFirst({
      where: { id: shareId, teamId },
    })
    if (!share) throw new NotFoundException('Share not found')
    if (share.sharedBy !== userId) {
      throw new ForbiddenException('Only creator can delete share')
    }

    await deleteShareWithAudit(this.prisma, {
      teamId,
      userId,
      shareId,
      shareType: share.type,
    })
  }

  private async checkMembership(teamId: string, userId: string) {
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (!membership) {
      throw new ForbiddenException('Not a team member')
    }
    return membership
  }

  private requireBaseVersion(baseVersion: number | undefined): bigint {
    if (baseVersion === undefined) {
      throw new HttpException(
        'baseVersion is required for share updates',
        HttpStatus.PRECONDITION_REQUIRED,
      )
    }
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
      throw new BadRequestException(
        'baseVersion must be a non-negative safe integer',
      )
    }
    return BigInt(baseVersion)
  }
}
