// frontend/src/store/notificationStore.ts
// ==================================================================
// Zero Plus - Notification Store (Zustand)
// بيخزن: قائمة الإشعارات + عدد غير المقروء + حالة اتصال السوكيت
// + طابور التوست + إعداد الصوت. الحقول مطابقة للباك (isRead / severity / type).
//   REST   (services/notificationsService) → التاريخ والعدّاد وتعليم المقروء
//   Socket (hooks/useNotificationsLive)    → receive() لما notification:new يوصل
// ==================================================================

import { create } from 'zustand'

import { parseApiError } from '../services/apiError'
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type NotificationsQuery,
} from '../services/notificationsService'
import { playNotificationSound } from '../utils/notificationSound'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'unauthorized'

const MAX_TOASTS = 5
const SOUND_KEY = 'zp-notification-sound'
const DEFAULT_LIMIT = 20

// ids اللي وصلت قبل كده (منع تكرار توست/عدّاد لو نفس الحدث وصل من مصدرين)
const seenIds = new Set<string>()

function readSoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

/** هل الإشعار الجديد يطابق فلاتر الصفحة الحالية؟ (عشان نضيفه للقائمة لحظيًا) */
function matchesQuery(n: AppNotification, q: NotificationsQuery): boolean {
  if (q.search) return false
  if (q.types && q.types.length > 0 && !q.types.includes(n.type)) return false
  if (q.minSeverity !== undefined && n.severity < q.minSeverity) return false
  return true
}

interface NotificationState {
  items: AppNotification[]
  pagination: { total: number; page: number; limit: number; totalPages: number }
  unreadCount: number
  query: NotificationsQuery
  loading: boolean
  loaded: boolean
  error: string | null
  connection: ConnectionStatus
  toasts: AppNotification[]
  /** ids الإشعارات "الجديدة" اللي بتتميز بلون مختلف في الصفحة */
  freshIds: string[]
  pageOpen: boolean
  soundEnabled: boolean

  fetchList: (query?: NotificationsQuery) => Promise<boolean>
  fetchUnreadCount: () => Promise<void>
  sync: () => Promise<void>
  receive: (notification: AppNotification, bumpUnread?: boolean) => void
  markRead: (id: string) => Promise<boolean>
  markAllRead: () => Promise<boolean>
  dismissToast: (id: string) => void
  setConnection: (status: ConnectionStatus) => void
  setPageOpen: (open: boolean) => void
  markFresh: (ids: string[]) => void
  clearFresh: () => void
  setSoundEnabled: (enabled: boolean) => void
  reset: () => void
}

const INITIAL = {
  items: [] as AppNotification[],
  pagination: { total: 0, page: 1, limit: DEFAULT_LIMIT, totalPages: 1 },
  unreadCount: 0,
  query: { page: 1, limit: DEFAULT_LIMIT } as NotificationsQuery,
  loading: false,
  loaded: false,
  error: null as string | null,
  toasts: [] as AppNotification[],
  freshIds: [] as string[],
}

// بيمنع رد قديم إنه يكتب فوق رد أحدث
let listRequest = 0

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  ...INITIAL,
  connection: 'idle',
  pageOpen: false,
  soundEnabled: readSoundPref(),

  fetchList: async (partial = {}) => {
    const query: NotificationsQuery = { ...get().query, ...partial }
    const id = ++listRequest
    set({ loading: true, query })
    try {
      const res = await listNotifications(query)
      if (id !== listRequest) return false
      set({
        items: res.data,
        pagination: {
          total: res.pagination.total,
          page: res.pagination.page,
          limit: res.pagination.limit,
          totalPages: res.pagination.totalPages,
        },
        unreadCount: res.unreadCount,
        loaded: true,
        error: null,
      })
      return true
    } catch (err) {
      if (id === listRequest) set({ error: parseApiError(err).message })
      return false
    } finally {
      if (id === listRequest) set({ loading: false })
    }
  },

  fetchUnreadCount: async () => {
    try {
      set({ unreadCount: await getUnreadCount() })
    } catch {
      /* الجرس مايعطلش حاجة لو الطلب فشل */
    }
  },

  // بعد ما السوكيت يرجع: نجيب اللي فاتنا وإحنا مقطوعين
  sync: async () => {
    await get().fetchUnreadCount()
    if (get().loaded) await get().fetchList()
  },

  receive: (notification, bumpUnread = true) => {
    if (seenIds.has(notification.id)) return
    seenIds.add(notification.id)
    if (seenIds.size > 500) seenIds.delete(seenIds.values().next().value as string)

    const state = get()
    const viewing = state.pageOpen

    // صفحة الإشعارات مفتوحة: الإشعار بيتعلّم مقروء فورًا من غير ما يزود الجرس
    const item: AppNotification = viewing ? { ...notification, isRead: true } : notification
    if (viewing && !notification.isRead) {
      void markNotificationRead(notification.id).catch(() => {})
    }

    const counts = bumpUnread && !item.isRead
    const addToList = state.pagination.page === 1 && matchesQuery(item, state.query)

    set({
      unreadCount: counts ? state.unreadCount + 1 : state.unreadCount,
      toasts: [...state.toasts, notification].slice(-MAX_TOASTS),
      ...(addToList && {
        items: [item, ...state.items.filter((i) => i.id !== item.id)].slice(0, state.pagination.limit),
        pagination: { ...state.pagination, total: state.pagination.total + 1 },
        freshIds: viewing ? [...state.freshIds, item.id] : state.freshIds,
      }),
    })

    if (state.soundEnabled) playNotificationSound(notification.severity)
  },

  // Optimistic: الواجهة تتحدث الأول، ولو الطلب فشل نرجّع
  markRead: async (id) => {
    const before = get()
    const target = before.items.find((i) => i.id === id)
    if (!target || target.isRead) return true
    set({
      items: before.items.map((i) => (i.id === id ? { ...i, isRead: true } : i)),
      unreadCount: Math.max(0, before.unreadCount - 1),
    })
    try {
      await markNotificationRead(id)
      return true
    } catch {
      set((s) => ({
        items: s.items.map((i) => (i.id === id ? { ...i, isRead: false } : i)),
        unreadCount: s.unreadCount + 1,
      }))
      return false
    }
  },

  markAllRead: async () => {
    const before = get()
    set({ items: before.items.map((i) => ({ ...i, isRead: true })), unreadCount: 0 })
    try {
      await markAllNotificationsRead()
      return true
    } catch {
      set({ items: before.items, unreadCount: before.unreadCount })
      return false
    }
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setConnection: (connection) => set({ connection }),
  setPageOpen: (pageOpen) => set({ pageOpen }),
  markFresh: (ids) => set({ freshIds: ids }),
  clearFresh: () => set({ freshIds: [] }),

  setSoundEnabled: (soundEnabled) => {
    try {
      localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off')
    } catch {
      /* مش مشكلة */
    }
    set({ soundEnabled })
  },

  reset: () => {
    seenIds.clear()
    listRequest++
    set({ ...INITIAL, connection: 'idle', pageOpen: false })
  },
}))

export default useNotificationStore
