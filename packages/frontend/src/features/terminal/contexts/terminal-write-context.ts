/**
 * Terminal Write Context
 * 终端写入上下文 - 跨组件共享终端写入函数
 */

/** 终端写入函数类型 */
type TerminalWriteFn = (data: string) => void

/** 全局写入函数 */
let writeFn: TerminalWriteFn | null = null

/**
 * 设置终端写入函数
 */
export function setTerminalWriteFn(fn: TerminalWriteFn) {
  writeFn = fn
}

/**
 * 获取终端写入函数
 */
export function getTerminalWriteFn(): TerminalWriteFn | null {
  return writeFn
}

/**
 * 清除终端写入函数
 */
export function clearTerminalWriteFn() {
  writeFn = null
}

/**
 * 写入数据到终端
 */
export function writeToTerminal(data: string) {
  if (writeFn) {
    writeFn(data)
  }
}
