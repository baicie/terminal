/**
 * Terminal Store - 兼容层
 *
 * 此文件已重构为使用 features/terminal/stores/ 中的独立模块。
 * 保留此文件以保持向后兼容，新代码应直接使用新 store。
 *
 * @deprecated 请使用 features/terminal/stores/
 */

export {
  useTerminalSessionStore,
  type TerminalSession,
  type TerminalSessionState,
} from '@/features/terminal/stores'

// Re-export for backward compatibility
import { useTerminalSessionStore } from '@/features/terminal/stores'

export const useTerminalStore = useTerminalSessionStore
