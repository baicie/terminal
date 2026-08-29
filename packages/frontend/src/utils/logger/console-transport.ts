import type { LogTransport } from './transport'
import { LogLevel } from './log-level'

const LEVEL_TAGS = {
  [LogLevel.Debug]: 'DBG',
  [LogLevel.Info]: 'INF',
  [LogLevel.Warn]: 'WRN',
  [LogLevel.Error]: 'ERR',
}

const COLORS = {
  [LogLevel.Debug]: '#3CABDB',
  [LogLevel.Info]: '#167FFC',
  [LogLevel.Warn]: '#595BD4',
  [LogLevel.Error]: '#FD3259',
}

function getFn(level: LogLevel) {
  if (level === LogLevel.Error) return console.error
  if (level === LogLevel.Warn) return console.warn
  if (level === LogLevel.Info) return console.info
  return console.debug
}

function padTwo(n: number): string {
  return n.toString().padStart(2, '0')
}

function timestamp(): string {
  const d = new Date()
  return `${padTwo(d.getHours())}:${padTwo(d.getMinutes())}:${padTwo(d.getSeconds())}.${padTwo(Math.floor(d.getMilliseconds() / 10))}`
}

export class ConsoleLogTransport implements LogTransport {
  constructor(public readonly maxLevel: LogLevel) {}

  log(level: LogLevel, module: string, msg: string): void {
    if (level > this.maxLevel) return
    this.render(level, module, msg)
  }

  private render(level: LogLevel, module: string, msg: string): void {
    const levelTag = LEVEL_TAGS[level]
    const moduleText = module ? `[${module}]` : ''
    getFn(level).call(
      console,
      `%c${levelTag}%c [${timestamp()}] ${moduleText} ${msg}`,
      `color: #FFF; background:${COLORS[level]};`,
      '',
    )
  }
}
