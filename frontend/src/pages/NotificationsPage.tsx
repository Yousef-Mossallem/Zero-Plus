// frontend/src/pages/NotificationsPage.tsx
// ==================================================================
// Zero Plus - Notifications Page
// صفحة إدارة وعرض Notifications (مربوطة بـ backend/modules/notifications)
//
//   GET    /notifications          → جلب قائمة Notifications مع Pagination
//   POST   /notifications/:id/read → تعليم إشعار فردي كمقروء
//   POST   /notifications/read-all → تعليم جميع Notifications كRead
//   DELETE /notifications/:id      → Delete إشعار محدد
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ElementType } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  X,
} from 'lucide-react'

import { useToast } from '../components/ui/Toast'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  PaginationBar,
  SelectInput,
  Skeleton,
  TextInput,
} from '../components/ui/kit'
import { Section } from '../components/ui/Section'
import { parseApiError } from '../services/apiError'
import apiClient from '../services/api'
import { getSocket, SocketEvents } from '../services/socket'
import type { Notification, NotificationType } from '../services/types'
import { useNotificationStore } from '../store/notificationStore'
import { cn, timeAgo } from '../utils/format'

// ==================================================================
// Types & Constants
// ==================================================================

type ReadFilter = 'all' | 'unread' | 'read'

interface NotificationFilters {
  search: string
  readStatus: ReadFilter
  type: NotificationType | 'all'
}

const NOTIFICATION_TYPE_META: Record<
  NotificationType | 'all',
  { label: string; color: string; icon: ElementType }
> = {
  all: { label: 'All types', color: 'text-slate-400', icon: Bell },
  INFO: { label: 'Info', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', icon: Info },
  WARNING: { label: 'Warning', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: AlertTriangle },
  ERROR: { label: 'Error', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20', icon: X },
  SUCCESS: { label: 'Success', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  SECURITY: { label: 'Security', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20', icon: Shield },
  REPORT_READY: { label: 'Report ready', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', icon: CheckCircle2 },
  SERVER_STATUS: { label: 'Server status', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', icon: Info },
}

const PAGE_SIZE = 20

// ==================================================================
// Page Component
// ==================================================================

export default function NotificationsPage() {
  const toast = useToast()

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1, page: 1 })

  const [filters, setFilters] = useState<NotificationFilters>({
    search: '',
    readStatus: 'unread',
    type: 'all',
  })

  const processedSocketIds = useRef<Set<string>>(new Set())
  const autoMarkedRef = useRef<Set<string>>(new Set())

  const setStoreNotifications = useNotificationStore((s) => s.setNotifications)
  const markAllAsReadStore = useNotificationStore((s) => s.markAllAsRead)
  const markAsReadStore = useNotificationStore((s) => s.markAsRead)
  const addNotificationStore = useNotificationStore((s) => s.addNotification)
  const removeNotificationStore = useNotificationStore((s) => s.removeNotification)
  const decrementUnread = useNotificationStore((s) => s.decrementUnread)

  const loadNotifications = useCallback(
    async (page: number = 1) => {
      setLoading(true)
      setError(null)
      try {
        const params: Record<string, string | number | boolean> = {
          page,
          limit: PAGE_SIZE,
        }

        if (filters.readStatus !== 'all') {
          params.read = filters.readStatus === 'read'
        }
        if (filters.type !== 'all') {
          params.type = filters.type
        }
        if (filters.search.trim()) {
          params.search = filters.search.trim()
        }

        const { data: res } = await apiClient.get<{
          success: boolean
          data: Notification[]
          pagination?: { total: number; totalPages: number; page?: number; limit?: number }
          summary?: { unreadCount?: number }
          // legacy shapes
          notifications?: Notification[]
          total?: number
          totalPages?: number
          unreadCount?: number
        }>('/notifications', { params })

        const list = res.data ?? res.notifications ?? []
        const total = res.pagination?.total ?? res.total ?? list.length
        const totalPages = res.pagination?.totalPages ?? res.totalPages ?? 1
        const unreadCount = res.summary?.unreadCount ?? res.unreadCount

        setNotifications(list)
        setPagination({ total, totalPages, page })
        setStoreNotifications(list)

        if (typeof unreadCount === 'number') {
          useNotificationStore.getState().setUnreadCount(unreadCount)
        }
      } catch (err) {
        const { message } = parseApiError(err)
        setError(message)
        toast.error('Load failed', 'تعذر جلب قائمة Notifications')
      } finally {
        setLoading(false)
      }
    },
    [filters, toast, setStoreNotifications],
  )

  useEffect(() => {
    void loadNotifications(1)
  }, [loadNotifications])

  // تعليم Notifications المعروضة كRead تلقائياً (بدون تكرار)
  useEffect(() => {
    if (loading || notifications.length === 0) return

    const unread = notifications.filter((n) => !n.read && !autoMarkedRef.current.has(n.id))
    if (unread.length === 0) return

    unread.forEach((n) => autoMarkedRef.current.add(n.id))

    // Refresh UI فوراً
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    markAllAsReadStore()

    // مزامنة مع الباك إند
    void apiClient.post('/notifications/read-all').catch((err) => {
      console.warn('Failed to auto-mark as read:', err)
    })
  }, [loading, notifications, markAllAsReadStore])

  // Socket: إشعار جديد
  useEffect(() => {
    const socket = getSocket()

    const handleNewNotification = (newNotification: Notification) => {
      if (processedSocketIds.current.has(newNotification.id)) return
      processedSocketIds.current.add(newNotification.id)

      addNotificationStore(newNotification)

      setNotifications((prev) => {
        if (filters.readStatus === 'read' && !newNotification.read) return prev
        if (filters.type !== 'all' && newNotification.type !== filters.type) return prev

        const q = filters.search.trim().toLowerCase()
        if (
          q &&
          !newNotification.title.toLowerCase().includes(q) &&
          !newNotification.message.toLowerCase().includes(q)
        ) {
          return prev
        }

        if (prev.some((n) => n.id === newNotification.id)) return prev
        return [newNotification, ...prev].slice(0, 100)
      })
    }

    socket.on(SocketEvents.NOTIFICATION_NEW, handleNewNotification)

    return () => {
      socket.off(SocketEvents.NOTIFICATION_NEW, handleNewNotification)
    }
  }, [filters, addNotificationStore])

  const handleFilterChange = (key: keyof NotificationFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  const clearFilters = () => {
    setFilters({ search: '', readStatus: 'unread', type: 'all' })
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  const handleMarkAllAsRead = async () => {
    setMarkingAll(true)
    try {
      await apiClient.post('/notifications/read-all')
      markAllAsReadStore()
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      toast.success('تم', 'تم تعليم جميع Notifications كRead')
    } catch (err) {
      toast.error('Error', parseApiError(err).message)
    } finally {
      setMarkingAll(false)
    }
  }

  const handleMarkOneRead = async (id: string) => {
    const target = notifications.find((n) => n.id === id)
    if (!target || target.read) return

    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    markAsReadStore(id)

    try {
      await apiClient.post(`/notifications/${id}/read`)
    } catch (err) {
      // rollback بسيط
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)))
      toast.error('Error', parseApiError(err).message)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await apiClient.delete(`/notifications/${id}`)
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      removeNotificationStore(id)
      toast.success('Deleted', 'تم Delete notification بSuccess')
    } catch (err) {
      toast.error('فشل الDelete', parseApiError(err).message)
    } finally {
      setDeletingId(null)
    }
  }

  const handlePageChange = (newPage: number) => {
    void loadNotifications(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const hasActiveFilters =
    filters.search !== '' || filters.readStatus !== 'unread' || filters.type !== 'all'

  const stats = useMemo(() => {
    const total = notifications.length
    const unread = notifications.filter((n) => !n.read).length
    const security = notifications.filter((n) => n.type === 'SECURITY').length
    return { total, unread, security }
  }, [notifications])

  return (
    <PageShell>
      <PageHeader
        icon={Bell}
        title="Notifications"
        subtitle="Monitor alerts and security notifications for your organization."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              icon={CheckCheck}
              onClick={() => void handleMarkAllAsRead()}
              disabled={loading || markingAll || stats.unread === 0}
              loading={markingAll}
            >
              Mark all read
            </Button>
            <Button
              icon={RefreshCw}
              loading={loading && notifications.length > 0}
              onClick={() => void loadNotifications(pagination.page)}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatMini label="Total Notifications" value={stats.total.toString()} icon={Bell} tone="indigo" />
        <StatMini label="Unread" value={stats.unread.toString()} icon={Info} tone="amber" />
        <StatMini label="Security alerts" value={stats.security.toString()} icon={Shield} tone="rose" />
      </div>

      <Card className="mb-6 p-4" delay={60}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <TextInput
              icon={Search}
              value={filters.search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleFilterChange('search', e.target.value)}
              placeholder="Search title or message..."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:shrink-0">
            <SelectInput
              value={filters.readStatus}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                handleFilterChange('readStatus', e.target.value as ReadFilter)
              }
              className="lg:w-44"
            >
              <option value="all" className="bg-slate-900">
                All statuses
              </option>
              <option value="unread" className="bg-slate-900">
                Unread
              </option>
              <option value="read" className="bg-slate-900">
                Read
              </option>
            </SelectInput>

            <SelectInput
              value={filters.type}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                handleFilterChange('type', e.target.value as NotificationType | 'all')
              }
              className="lg:w-48"
            >
              {Object.entries(NOTIFICATION_TYPE_META).map(([key, meta]) => (
                <option key={key} value={key} className="bg-slate-900">
                  {meta.label}
                </option>
              ))}
            </SelectInput>
          </div>

          {hasActiveFilters && (
            <Button icon={X} variant="ghost" onClick={clearFilters} className="shrink-0">
              Clear
            </Button>
          )}
        </div>
      </Card>

      {error && notifications.length === 0 ? (
        <Card>
          <ErrorState message={error} onRetry={() => void loadNotifications(1)} />
        </Card>
      ) : loading && notifications.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bell}
            title={hasActiveFilters ? 'No notifications مطابقة' : 'No notifications حالياً'}
            description={
              hasActiveFilters
                ? 'جرب تغيير Filters أو Clearها لرؤية جميع Notifications.'
                : 'ستظهر هنا Notifications الجديدة فور وصولها عبر النظام.'
            }
            action={
              hasActiveFilters ? (
                <Button icon={X} onClick={clearFilters}>
                  Clear Filters
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification, index) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              index={index}
              isDeleting={deletingId === notification.id}
              onMarkRead={() => void handleMarkOneRead(notification.id)}
              onDelete={() => void handleDelete(notification.id)}
            />
          ))}
        </div>
      )}

      {!loading && notifications.length > 0 && pagination.totalPages > 1 && (
        <Card className="mt-6">
          <PaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={PAGE_SIZE}
            disabled={loading}
            onPage={handlePageChange}
          />
        </Card>
      )}
    </PageShell>
  )
}

// ==================================================================
// Sub-Components
// ==================================================================

function StatMini({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: ElementType
  tone: string
}) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  }

  return (
    <div className={cn('zp-anim-fade-up rounded-xl border p-4', tones[tone])}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider opacity-80">{label}</p>
          <p className="mt-1 text-2xl font-bold text-white">{value}</p>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function NotificationRow({
  notification,
  index,
  isDeleting,
  onMarkRead,
  onDelete,
}: {
  notification: Notification
  index: number
  isDeleting: boolean
  onMarkRead: () => void
  onDelete: () => void
}) {
  const meta = NOTIFICATION_TYPE_META[notification.type] || NOTIFICATION_TYPE_META.INFO
  const TypeIcon = meta.icon

  return (
    <div
      className={cn(
        'zp-anim-fade-up group relative flex flex-col gap-3 rounded-xl border p-4 transition-all sm:flex-row sm:items-start sm:justify-between',
        notification.read
          ? 'border-white/8 bg-white/3 hover:bg-white/5'
          : 'border-cyan-500/30 bg-cyan-500/5 shadow-lg shadow-cyan-500/5',
        isDeleting && 'pointer-events-none opacity-50',
      )}
      style={{ animationDelay: `${Math.min(index * 40, 300)}ms` }}
      onClick={onMarkRead}
    >
      <div className="flex flex-1 items-start gap-4">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', meta.color)}>
          <TypeIcon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{notification.title}</span>
            {!notification.read && <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />}
          </div>

          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{notification.message}</p>

          <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
            <span>{timeAgo(notification.createdAt)}</span>
            <span>•</span>
            <span className={cn('font-medium', meta.color.split(' ')[0])}>{meta.label}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:border-r sm:border-white/8 sm:pr-4">
        {!notification.read && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMarkRead()
            }}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400"
            title="Mark as read"
            type="button"
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          disabled={isDeleting}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
          title="Delete notification"
          type="button"
        >
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}