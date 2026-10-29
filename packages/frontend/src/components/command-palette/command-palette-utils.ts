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

export function formatTimeAgo(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
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

export function getTypeLabel(type: ResultType): string {
  switch (type) {
    case 'host':
      return 'host'
    case 'sftp':
      return 'sftp'
    case 'snippet':
      return 'snippet'
    case 'history':
      return 'history'
    case 'workspace':
      return 'workspace'
    case 'open-tab':
      return 'tab'
    case 'closed-tab':
      return 'closed'
    case 'action':
      return 'action'
  }
}
