import type { TransformFnParams } from 'class-transformer'
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common'

export const IDENTIFIER_PATTERN = /^\w[\w.:-]{0,127}$/

export function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value
}

@Injectable()
export class IdentifierPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
      throw new BadRequestException('Invalid identifier')
    }
    return value
  }
}
