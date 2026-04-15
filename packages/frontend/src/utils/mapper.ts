/**
 * 数据库行映射工具
 * 提供通用的类型转换函数
 */

/**
 * 基础映射器类型
 */
export type RowMapper<TFrom, TTo> = (row: TFrom) => TTo

/**
 * 映射配置
 */
export interface MappingConfig<TFrom extends object, TTo extends object> {
  /** 直接映射的字段 */
  direct?: Partial<Record<keyof TTo, keyof TFrom>>
  /** 需要 JSON.parse 的字段 */
  jsonFields?: (keyof TTo)[]
  /** 需要特殊处理的字段 */
  transforms?: Partial<
    Record<keyof TTo, (value: unknown, row: TFrom) => unknown>
  >
  /** 布尔字段（值为 0/1） */
  booleanFields?: (keyof TTo)[]
  /** 可选字段（值为 null 时转为 undefined） */
  nullableFields?: (keyof TTo)[]
}

/**
 * 创建映射配置
 */
export function createMappingConfig<
  TFrom extends object,
  TTo extends object,
>(): MappingConfig<TFrom, TTo> {
  return {
    direct: {},
    jsonFields: [],
    transforms: {},
    booleanFields: [],
    nullableFields: [],
  }
}

/**
 * 使用映射配置转换行数据
 */
export function mapRow<TFrom extends object, TTo extends object>(
  row: TFrom,
  config: MappingConfig<TFrom, TTo>,
): TTo {
  const result = {} as TTo

  // 直接映射
  if (config.direct) {
    for (const [toKey, fromKey] of Object.entries(config.direct)) {
      if (fromKey && fromKey in row) {
        const value = row[fromKey as keyof TFrom]
        ;(result as Record<string, unknown>)[toKey] = value
      }
    }
  }

  // JSON 字段
  if (config.jsonFields) {
    for (const key of config.jsonFields) {
      const value = (row as Record<string, unknown>)[key as string]
      if (value !== null && value !== undefined) {
        try {
          ;(result as Record<string, unknown>)[key as string] =
            typeof value === 'string' ? JSON.parse(value) : value
        } catch {
          ;(result as Record<string, unknown>)[key as string] = undefined
        }
      }
    }
  }

  // 布尔字段（0/1 -> true/false）
  if (config.booleanFields) {
    for (const key of config.booleanFields) {
      const value = (row as Record<string, unknown>)[key as string]
      ;(result as Record<string, unknown>)[key as string] = value === 1
    }
  }

  // 可选字段（null -> undefined）
  if (config.nullableFields) {
    for (const key of config.nullableFields) {
      const value = (row as Record<string, unknown>)[key as string]
      if (value === null) {
        ;(result as Record<string, unknown>)[key as string] = undefined
      }
    }
  }

  // 特殊转换
  if (config.transforms) {
    for (const [key, transform] of Object.entries(config.transforms)) {
      if (transform) {
        const value = (row as Record<string, unknown>)[key as string]
        ;(result as Record<string, unknown>)[key] = transform(value, row)
      }
    }
  }

  return result
}

/**
 * 批量转换行数据
 */
export function mapRows<TFrom extends object, TTo extends object>(
  rows: TFrom[],
  config: MappingConfig<TFrom, TTo>,
): TTo[] {
  return rows.map(row => mapRow(row, config))
}

/**
 * 通用行映射器工厂
 * 用于创建简单的字段映射
 */
export function createRowMapper<TFrom extends object, TTo>(
  mapping: Partial<Record<keyof TTo, keyof TFrom>>,
): RowMapper<TFrom, TTo> {
  return (row: TFrom) => {
    const result = {} as TTo
    for (const [toKey, fromKey] of Object.entries(mapping)) {
      if (fromKey && fromKey in row) {
        ;(result as Record<string, unknown>)[toKey] =
          row[fromKey as keyof TFrom]
      }
    }
    return result
  }
}
