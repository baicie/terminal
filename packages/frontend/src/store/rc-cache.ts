/**
 * Shell RC Cache
 *
 * Caches parsed shell RC (aliases / functions) per session,
 * so we don't re-parse on every keystroke.
 */

import { create } from 'zustand'
import type { RCCompletionItem } from '../service/shell-rc'

interface RCCacheState {
  // Cache: sessionId -> parsed RC items
  cache: Map<string, RCCompletionItem[]>
  // Cache metadata: sessionId -> { parsedAt: number }
  meta: Map<string, { parsedAt: number }>
  // Set items for a session
  set: (sessionId: string, items: RCCompletionItem[]) => void
  // Get items for a session
  get: (sessionId: string) => RCCompletionItem[]
  // Check if session has been parsed (within TTL)
  has: (sessionId: string) => boolean
  // Clear cache for a session
  clear: (sessionId: string) => void
  // Clear all
  clearAll: () => void
}

// 5 minute TTL for parsed RC data
const TTL_MS = 5 * 60 * 1000

export const useRCCache = create<RCCacheState>((set, get) => ({
  cache: new Map(),
  meta: new Map(),

  set(sessionId, items) {
    set(state => {
      const nextCache = new Map(state.cache)
      nextCache.set(sessionId, items)
      const nextMeta = new Map(state.meta)
      nextMeta.set(sessionId, { parsedAt: Date.now() })
      return { cache: nextCache, meta: nextMeta }
    })
  },

  get(sessionId) {
    const state = get()
    const meta = state.meta.get(sessionId)
    if (!meta) return []
    if (Date.now() - meta.parsedAt > TTL_MS) return []
    return state.cache.get(sessionId) ?? []
  },

  has(sessionId) {
    return get().get(sessionId).length > 0
  },

  clear(sessionId) {
    set(state => {
      const nextCache = new Map(state.cache)
      nextCache.delete(sessionId)
      const nextMeta = new Map(state.meta)
      nextMeta.delete(sessionId)
      return { cache: nextCache, meta: nextMeta }
    })
  },

  clearAll() {
    set({ cache: new Map(), meta: new Map() })
  },
}))
