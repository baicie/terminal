import { Type } from 'class-transformer'
import {
  Allow,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { IDENTIFIER_PATTERN } from '../http-validation'

const MAX_SYNC_BATCH_SIZE = 500

export class SyncShareDto {
  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  id!: string

  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  teamId!: string

  @IsIn(['HOST', 'HOST_GROUP', 'SNIPPET_PACKAGE'])
  type!: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE'

  @Allow()
  @IsDefined()
  data!: unknown

  @ValidateIf(
    (share: SyncShareDto) =>
      share.isSensitive === true || share.encryptedData !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(900_000)
  encryptedData?: string

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean

  @IsIn(['READONLY', 'READWRITE'])
  permission!: 'READONLY' | 'READWRITE'

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  baseVersion?: number

  /**
   * Declared intent. CREATE must not collide with an existing share, UPDATE
   * must target an existing share and carry a server baseVersion; omitting it
   * is the legacy "undeclared write" path (docs/phase8/sync-protocol.md §1).
   */
  @IsOptional()
  @IsIn(['CREATE', 'UPDATE', 'DELETE'])
  operation?: 'CREATE' | 'UPDATE' | 'DELETE'
}

export class PushChangesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SYNC_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => SyncShareDto)
  shares?: SyncShareDto[]

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SYNC_BATCH_SIZE)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  @Matches(IDENTIFIER_PATTERN, { each: true })
  deleteShares?: string[]
}

class ConflictItemDto {
  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  id!: string

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  updatedAt!: number

  @IsIn(['HOST', 'SNIPPET_PACKAGE'])
  type!: 'HOST' | 'SNIPPET_PACKAGE'
}

export class ConflictCheckDto {
  @IsArray()
  @ArrayMaxSize(MAX_SYNC_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => ConflictItemDto)
  items!: ConflictItemDto[]
}

class ConflictClientDataDto {
  @Allow()
  @IsDefined()
  data!: unknown

  @ValidateIf(
    (share: ConflictClientDataDto) =>
      share.isSensitive === true || share.encryptedData !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(900_000)
  encryptedData?: string

  @IsDefined()
  @IsBoolean()
  isSensitive!: boolean

  @IsOptional()
  @IsIn(['READONLY', 'READWRITE'])
  permission?: 'READONLY' | 'READWRITE'
}

export class ResolveConflictDto {
  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  shareId!: string

  @IsIn(['LOCAL', 'REMOTE'])
  resolution!: 'LOCAL' | 'REMOTE'

  @ValidateIf(
    (request: ResolveConflictDto, value: unknown) =>
      request.resolution === 'LOCAL' || value !== undefined,
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => ConflictClientDataDto)
  clientData?: ConflictClientDataDto
}

export class EnqueueOperationDto {
  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  teamId!: string

  @IsIn(['CREATE', 'UPDATE', 'DELETE'])
  operation!: 'CREATE' | 'UPDATE' | 'DELETE'

  @IsIn(['HOST', 'HOST_GROUP', 'SNIPPET_PACKAGE'])
  shareType!: 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE'

  @IsString()
  @Matches(IDENTIFIER_PATTERN)
  shareId!: string

  @ValidateIf(
    (request: EnqueueOperationDto, value: unknown) =>
      request.operation !== 'DELETE' || value !== undefined,
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => SyncShareDto)
  data?: SyncShareDto
}

export class SyncQueryDto {
  /**
   * Opaque sync cursor. The composite form is `2.<bound>.<txid>.<seq>`; a bare
   * decimal number is the legacy single-watermark cursor and is still accepted,
   * so an old client resyncs safely instead of being rejected
   * (docs/phase8/sync-protocol.md §3.7).
   */
  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(80)
  @Matches(/^\d{1,20}(?:\.\d{1,20})*$/)
  since?: string
}
