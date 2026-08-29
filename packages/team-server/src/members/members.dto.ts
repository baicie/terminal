import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator'
import { IDENTIFIER_PATTERN, trimString } from '../http-validation'

export type TeamRole = 'ADMIN' | 'MEMBER'

export class AddMemberDto {
  @Transform(trimString)
  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  userId!: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userName?: string

  @Transform(trimString)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  userEmail?: string

  @IsOptional()
  @IsIn(['ADMIN', 'MEMBER'])
  role?: TeamRole
}

export class UpdateMemberRoleDto {
  @IsIn(['ADMIN', 'MEMBER'])
  role!: TeamRole
}
