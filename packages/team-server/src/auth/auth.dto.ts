import { Transform } from 'class-transformer'
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

function trimString({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value
}

export class RegisterDto {
  @Transform(trimString)
  @IsString()
  @Matches(/^\w[\w.:-]{0,127}$/)
  userId!: string

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string
}

export class CreateTokenDto {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string
}
