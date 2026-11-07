import type { TFunction } from 'i18next'
import type { ResultType } from './command-palette-types'

export function fuzzyScore(pattern: string, text: string): number {
  if (!pattern) return 1
  const lowerPattern = pattern.toLowerCase()
  const lowerText = text.toLowerCase()
  if (lowerText.startsWith(lowerPattern)) return 100 + pattern.length
  if (lowerText.includes(lowerPattern)) return 50 + pattern.length / text.length

  let patternIndex = 0
  let consecutive = 0
  let score = 0
  for (
    let index = 0;
    index < text.length && patternIndex < pattern.length;
    index++
  ) {
    if (lowerText[index] === lowerPattern[patternIndex]) {
      patternIndex++
      consecutive++
      score += consecutive * 2
    } else {
      consecutive = 0
    }
  }
  return patternIndex < pattern.length ? 0 : score
}

export function fuzzyMatch(pattern: string, text: string): boolean {
  return fuzzyScore(pattern, text) > 0
}

export function formatTimeAgo(timestamp: number, t: TFunction): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return t('cmdHistory.justNow')
  if (minutes < 60) return t('cmdHistory.minAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('cmdHistory.hoursAgo', { count: hours })
  return t('cmdHistory.daysAgo', { count: Math.floor(hours / 24) })
}

export function getTypeBadgeClass(type: ResultType): string {
  switch (type) {
    case 'host':
      return 'bg-blue-500/10 text-blue-500'
    case 'sftp':
      return 'bg-teal-500/10 text-teal-500'
    case 'snippet':
      return 'bg-green-500/10 text-green-500'
    case 'history':
      return 'bg-orange-500/10 text-orange-500'
    case 'workspace':
      return 'bg-violet-500/10 text-violet-500'
    case 'open-tab':
      return 'bg-cyan-500/10 text-cyan-500'
    case 'closed-tab':
      return 'bg-muted text-muted-foreground'
    default:
      return 'bg-purple-500/10 text-purple-500'
  }
}

export function getTypeLabelKey(type: ResultType): string {
  switch (type) {
    case 'host':
      return 'cmdPalette.typeHost'
    case 'sftp':
      return 'cmdPalette.typeSftp'
    case 'snippet':
      return 'cmdPalette.typeSnippet'
    case 'history':
      return 'cmdPalette.typeHistory'
    case 'workspace':
      return 'cmdPalette.typeWorkspace'
    case 'open-tab':
      return 'cmdPalette.typeTab'
    case 'closed-tab':
      return 'cmdPalette.typeClosed'
    case 'action':
      return 'cmdPalette.typeAction'
  }
}
