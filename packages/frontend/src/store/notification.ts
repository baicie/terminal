import { create } from 'zustand'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message?: string
  timestamp: number
  read: boolean
  persistent: boolean
}

interface NotificationState {
  notifications: Notification[]
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => string
  markRead: (id: string) => void
  markAllRead: () => void
  removeNotification: (id: string) => void
  clearAll: () => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  addNotification(n) {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const notification: Notification = {
      ...n,
      id,
      timestamp: Date.now(),
      read: false,
    }
    set(state => ({
      notifications: [notification, ...state.notifications],
    }))
    return id
  },

  markRead(id) {
    set(state => ({
      notifications: state.notifications.map(n =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }))
  },

  markAllRead() {
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, read: true })),
    }))
  },

  removeNotification(id) {
    set(state => ({
      notifications: state.notifications.filter(n => n.id !== id),
    }))
  },

  clearAll() {
    set({ notifications: [] })
  },
}))
