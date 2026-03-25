import { Logger } from '@/utils/logger/logger'
import { ConsoleLogTransport } from '@/utils/logger/console-transport'
import { LogLevel } from '@/utils/logger/log-level'

const _logger = new Logger([new ConsoleLogTransport(LogLevel.Debug)])

export function getLogger(): Logger {
  return _logger
}

export function useLogger(): Logger {
  return _logger
}
