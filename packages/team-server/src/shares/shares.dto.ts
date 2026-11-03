import {
  Allow,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'

export type ShareType = 'HOST' | 'HOST_GROUP' | 'SNIPPET_PACKAGE'
export type SharePermission = 'READONLY' | 'READWRITE'

export class CreateShareDto {
  @IsIn(['HOST', 'HOST_GROUP', 'SNIPPET_PACKAGE'])
  type!: ShareType

  @Allow()
  @ValidateIf((share: CreateShareDto) => share.isSensitive !== true)
  @IsDefined()
  data?: unknown

  @ValidateIf(
    (share: CreateShareDto) =>
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
  permission!: SharePermission
}

export class UpdateShareDto {
  /**
   * The server-issued version the caller read. The REST endpoint is an
   * optimistic-concurrency update: without it the server cannot tell a fresh
   * edit from a late write based on stale data, so it is required by the
   * service even though the field is optional at the DTO layer (which lets
   * the controller return 428 instead of a generic validation error).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  baseVersion?: number

  @IsOptional()
  @IsIn(['READONLY', 'READWRITE'])
  permission?: SharePermission

  @Allow()
  @IsOptional()
  data?: unknown

  @ValidateIf(
    (share: UpdateShareDto) =>
      share.isSensitive === true || share.encryptedData !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(900_000)
  encryptedData?: string

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean
}
