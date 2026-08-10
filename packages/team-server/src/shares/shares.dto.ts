import {
  Allow,
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
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
