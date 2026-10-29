import type { TabType } from '@/features/terminal/types'
import { useEffect, type RefObject } from 'react'
import {
  parseShellRC,
  toCompletionItems,
  type RCCompletionItem,
} from '@/service/shell-rc'
import { useRCCache } from '@/store/rc-cache'

export function useShellRcCompletion(
  sessionId: string | null,
  status: string,
  tabType: TabType | undefined,
  rcItemsRef: RefObject<RCCompletionItem[]>,
) {
  const cache = useRCCache()
  useEffect(() => {
    if (!sessionId || status !== 'connected' || cache.has(sessionId)) return
    const sessionType = tabType === 'remote' ? 'ssh' : 'local'
    parseShellRC({ sessionId, sessionType, shell: 'bash' })
      .then(parsed => cache.set(sessionId, toCompletionItems(parsed)))
      .catch(() => {})
  }, [sessionId, status, tabType, cache])

  rcItemsRef.current = cache.get(sessionId ?? '') ?? []
}
