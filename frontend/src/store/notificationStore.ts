// frontend/src/store/notificationStore.ts
// إدارة حالة الإشعارات والـ Badge والـ Toasts
import { create } from 'zustand'
import type { Notification } from '../services/types'

interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  toasts: Notification[]

  setNotifications: (notifications: Notification[]) => void
  setUnreadCount: (count: number) => void
  addNotification: (notification: Notification) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  decrementUnread: () => void
  removeNotification: (id: string) => void
  addToast: (notification: Notification) => void
  removeToast: (id: string) => void
  clearToasts: () => void
  reset: () => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  toasts: [],

  setNotifications: (notifications) => {
    const unreadCount = notifications.filter((n) => !n.read).length
    set({ notifications, unreadCount })
  },

  setUnreadCount: (count) => set({ unreadCount: Math.max(0, count) }),

  addNotification: (notification) => {
    const { notifications } = get()
    if (notifications.some((n) => n.id === notification.id)) return

    const next = [notification, ...notifications].slice(0, 100)
    set({
      notifications: next,
      unreadCount: notification.read ? get().unreadCount : get().unreadCount + 1,
    })
  },

  markAsRead: (id) => {
    const { notifications, unreadCount } = get()
    const target = notifications.find((n) => n.id === id)
    if (!target || target.read) return

    set({
      notifications: notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
      unreadCount: Math.max(0, unreadCount - 1),
    })
  },

  markAllAsRead: () => {
    const { notifications } = get()
    set({
      notifications: notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })
  },

  decrementUnread: () => {
    set({ unreadCount: Math.max(0, get().unreadCount - 1) })
  },

  removeNotification: (id) => {
    const { notifications, unreadCount } = get()
    const target = notifications.find((n) => n.id === id)
    set({
      notifications: notifications.filter((n) => n.id !== id),
      unreadCount: target && !target.read ? Math.max(0, unreadCount - 1) : unreadCount,
    })
  },

  addToast: (notification) => {
    const { toasts } = get()
    if (toasts.some((t) => t.id === notification.id)) return
    set({ toasts: [notification, ...toasts].slice(0, 5) })
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  clearToasts: () => set({ toasts: [] }),

  reset: () => set({ notifications: [], unreadCount: 0, toasts: [] }),
}))