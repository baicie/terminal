/**
 * ID 生成工具
 * 统一使用 crypto.randomUUID() 生成符合 RFC 4122 的 UUID v4
 */

/**
 * 生成符合 RFC 4122 的 UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * 生成短 ID (12 字符十六进制)
 * 适用于需要较短 ID 的场景
 */
export function generateShortId(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12)
}

/**
 * 生成带前缀的 ID
 * @param prefix 前缀，如 'host', 'tab', 'group'
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${generateId()}`
}

/**
 * 生成时间戳 + 随机后缀的 ID (兼容旧格式)
 * @deprecated 推荐使用 generateId() 替代
 */
export function generateLegacyId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}
