import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator'

export type InviteType = 'LINK' | 'CODE' | 'EMAIL'
export type InviteRole = 'ADMIN' | 'MEMBER'

function trimString({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value
}

function normalizeInviteCode({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim().toUpperCase() : value
}

export class CreateInviteDto {
  @IsIn(['LINK', 'CODE', 'EMAIL'])
  type!: InviteType

  @Transform(trimString)
  @ValidateIf((invite: CreateInviteDto) => invite.type === 'EMAIL')
  @IsEmail()
  @MaxLength(254)
  email?: string

  @IsOptional()
  @IsIn(['ADMIN', 'MEMBER'])
  role?: InviteRole
}

export class JoinByCodeDto {
  @Transform(normalizeInviteCode)
  @IsString()
  @Matches(/^TEAM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  code!: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userName?: string
}

export class JoinByLinkDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userName?: string
}
