// frontend/src/pages/NotificationsPage.tsx
// ==================================================================
// Zero Plus - Notifications Page
// صفحة الإشعارات الكاملة (مربوطة بـ backend/modules/notifications + Socket.IO)
//
//   - التاريخ:   GET /notifications (فلاتر + pagination) عن طريق الـ store
//   - اللحظي:    notification:new من السوكيت بيدخل أعلى القائمة فورًا
//   - "جديد":    أول ما تفتح الصفحة بنسجّل ids الغير مقروء (freshIds) ثم
//                نعلّم الكل مقروء، فالإشعارات الجديدة تفضل مميزة بلون مختلف
//                طول ما انت في الصفحة، والجرس يصفّر
//   - الصوت:    زرار كتم/تشغيل (محفوظ في localStorage)
//
// ملحوظة: isRead على مستوى الشركة (الباك مفيهوش userId في الإشعارات)،
// فتعليم "مقروء" هنا بيأثر على كل أعضاء الشركة.
// ==================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  BellRing,
  CheckCheck,
  Radio,
  RefreshCw,
  Search,
  Volume2,
  VolumeX,
  WifiOff,
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
  Skeleton,
  TextInput,
  Toggle,
} from '../components/ui/kit'
import { useDebounce } from '../hooks/useDebounce'
import type { NotificationsQuery } from '../services/notificationsService'
import useNotificationStore, { type ConnectionStatus } from '../store/notificationStore'
import { NOTIFICATION_TYPES, TYPE_META, type NotificationType } from '../utils/notificationMeta'
import type { AppNotification } from '../services/notificationsService'
import { cn, formatDate, formatNumber } from '../utils/format'
import NotificationItem from './notifications/NotificationItem'

const CONNECTION_LABEL: Record<ConnectionStatus, { text: string; hint: string }> = {
  connected: { text: 'Live', hint: 'Real-time updates are on' },
  connecting: { text: 'Connecting…', hint: 'Reaching the server' },
  disconnected: { text: 'Offline', hint: 'Retrying automatically' },
  unauthorized: { text: 'Signed out', hint: 'Session rejected by the socket' },
  idle: { text: 'Idle', hint: 'Not connected' },
}

const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any' },
  { value: '2', label: 'Notice+' },
  { value: '3', label: 'Important+' },
  { value: '4', label: 'Critical+' },
]

/** تجميع الإشعارات حسب اليوم (Today / Yesterday / تاريخ) مع الحفاظ على الترتيب */
function groupByDay(items: AppNotification[]): { label: string; items: AppNotification[] }[] {
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86_400_000).toDateString()
  const groups: { key: string; label: string; items: AppNotification[] }[] = []
  for (const n of items) {
    const key = new Date(n.createdAt).toDateString()
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      g = { key, label: key === today ? 'Today' : key === yesterday ? 'Yesterday' : formatDate(n.createdAt), items: [] }
      groups.push(g)
    }
    g.items.push(n)
  }
  return groups
}

export default function NotificationsPage() {
  const toast = useToast()

  // ---------------- Store ----------------
  const items = useNotificationStore((s) => s.items)
  const pagination = useNotificationStore((s) => s.pagination)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const loading = useNotificationStore((s) => s.loading)
  const loaded = useNotificationStore((s) => s.loaded)
  const error = useNotificationStore((s) => s.error)
  const connection = useNotificationStore((s) => s.connection)
  const freshIds = useNotificationStore((s) => s.freshIds)
  const soundEnabled = useNotificationStore((s) => s.soundEnabled)

  // ---------------- Filters ----------------
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [severity, setSeverity] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const debouncedSearch = useDebounce(search)

  const query = useMemo<NotificationsQuery>(
    () => ({
      page,
      limit,
      ...(unreadOnly && { unreadOnly: true }),
      ...(type && { types: [type as NotificationType] }),
      ...(severity && { minSeverity: Number(severity) }),
      ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
    }),
    [page, limit, unreadOnly, type, severity, debouncedSearch],
  )

  // ---------------- Lifecycle ----------------
  // الصفحة مفتوحة: الإشعار اللي يوصل دلوقتي بيتعلّم مقروء تلقائيًا
  useEffect(() => {
    const { setPageOpen, clearFresh } = useNotificationStore.getState()
    setPageOpen(true)
    return () => {
      setPageOpen(false)
      clearFresh()
    }
  }, [])

  // كل تغيير في الفلاتر = طلب جديد. أول نجاح = تعليم الكل مقروء (مرة واحدة)
  const autoMarked = useRef(false)
  useEffect(() => {
    const run = async () => {
      const store = useNotificationStore.getState()
      const ok = await store.fetchList(query)

      if (!ok) {
        toast.error('Failed to load notifications', useNotificationStore.getState().error ?? undefined)
        return
      }
      if (autoMarked.current) return
      autoMarked.current = true

      // نسجّل الغير مقروء قبل ما نعلّمه، عشان يفضل مميز بلون مختلف
      const unreadIds = useNotificationStore
        .getState()
        .items.filter((n) => !n.isRead)
        .map((n) => n.id)
      store.markFresh(unreadIds)

      if (useNotificationStore.getState().unreadCount > 0 || unreadIds.length > 0) {
        const marked = await store.markAllRead()
        if (!marked) toast.error('Could not mark notifications as read')
      }
    }
    void run()
    // toast ثابت
  }, [query, toast])

  // تحديث "منذ كذا" كل 30 ثانية
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // ---------------- Handlers ----------------
  const hasFilters = Boolean(search || type || severity || unreadOnly)
  const resetPage = () => setPage(1)

  const clearFilters = () => {
    setSearch('')
    setType('')
    setSeverity('')
    setUnreadOnly(false)
    resetPage()
  }

  const handleMarkAll = async () => {
    const ok = await useNotificationStore.getState().markAllRead()
    if (ok) toast.success('All notifications marked as read')
    else toast.error('Could not mark notifications as read')
  }

  const handleMarkOne = async (id: string) => {
    const ok = await useNotificationStore.getState().markRead(id)
    if (!ok) toast.error('Could not mark the notification as read')
  }

  const conn = CONNECTION_LABEL[connection]
  const live = connection === 'connected'
  const fresh = new Set(freshIds)
  const groups = useMemo(() => groupByDay(items), [items])
  const firstLoad = loading && items.length === 0

  const chip = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition lg:w-full lg:border-transparent lg:py-2 lg:text-sm',
      active
        ? 'border-cyan-400/40 bg-cyan-500/15 text-white'
        : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-white',
    )

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={Bell}
        title="Notifications"
        subtitle="Security alerts and system updates, as they happen."
        actions={
          <>
            <Button icon={RefreshCw} loading={loading && items.length > 0} onClick={() => void useNotificationStore.getState().fetchList()}>
              Refresh
            </Button>
            <Button variant="primary" icon={CheckCheck} disabled={unreadCount === 0} onClick={() => void handleMarkAll()}>
              Mark all read
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* ============ Side panel ============ */}
        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          {/* Live status + unread */}
          <Card accent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl',
                    live ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400',
                  )}
                >
                  {live ? <Radio className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{conn.text}</p>
                  <p className="text-xs text-slate-500">{conn.hint}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={soundEnabled ? Volume2 : VolumeX}
                aria-label={soundEnabled ? 'Mute notification sound' : 'Unmute notification sound'}
                title={soundEnabled ? 'Mute notification sound' : 'Unmute notification sound'}
                onClick={() => useNotificationStore.getState().setSoundEnabled(!soundEnabled)}
              />
            </div>

            <div className="mt-4 flex items-end justify-between border-t border-white/5 pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Unread</p>
                {!loaded && loading ? (
                  <div className="zp-skeleton mt-1 h-8 w-12 rounded-md" />
                ) : (
                  <p className="text-3xl font-bold tracking-tight text-white">{formatNumber(unreadCount)}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {hasFilters ? 'Matching' : 'Total'}
                </p>
                <p className="text-xl font-semibold text-slate-300">{formatNumber(pagination.total)}</p>
              </div>
            </div>
          </Card>

          {/* Filters */}
          <Card className="space-y-5 p-5">
            <TextInput
              icon={Search}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                resetPage()
              }}
              placeholder="Search…"
            />

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Type</p>
              <div className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
                <button
                  type="button"
                  className={chip(type === '')}
                  onClick={() => {
                    setType('')
                    resetPage()
                  }}
                >
                  <BellRing className="h-4 w-4" />
                  All types
                </button>
                {NOTIFICATION_TYPES.map((t) => {
                  const TypeIcon = TYPE_META[t].icon
                  return (
                    <button
                      key={t}
                      type="button"
                      className={chip(type === t)}
                      onClick={() => {
                        setType(type === t ? '' : t)
                        resetPage()
                      }}
                    >
                      <TypeIcon className="h-4 w-4" />
                      {TYPE_META[t].label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Severity</p>
              <div className="grid grid-cols-2 gap-1.5">
                {SEVERITY_OPTIONS.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    className={cn(chip(severity === o.value), 'justify-center lg:py-1.5')}
                    onClick={() => {
                      setSeverity(o.value)
                      resetPage()
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between text-sm text-slate-300">
              Unread only
              <Toggle
                checked={unreadOnly}
                onChange={(v) => {
                  setUnreadOnly(v)
                  resetPage()
                }}
                label="Unread only"
              />
            </label>

            {hasFilters && (
              <Button icon={X} variant="ghost" className="w-full" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </Card>
        </aside>

        {/* ============ Timeline ============ */}
        <section className="min-w-0 space-y-6">
          {error && items.length === 0 ? (
            <Card>
              <ErrorState message={error} onRetry={() => void useNotificationStore.getState().fetchList()} />
            </Card>
          ) : firstLoad ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <Skeleton className="h-24 flex-1 rounded-2xl" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <Card>
              <EmptyState
                icon={Bell}
                title={hasFilters ? 'No notifications match these filters' : "You're all caught up"}
                description={
                  hasFilters
                    ? 'Try widening the filters.'
                    : 'Attack alerts, new blocks and server updates will show up here the moment they happen.'
                }
                action={
                  hasFilters ? (
                    <Button icon={X} onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <>
              <div className={cn('space-y-8', loading && 'opacity-60')}>
                {groups.map((g) => (
                  <div key={g.label + g.items[0]?.id}>
                    <div className="mb-3 flex items-center gap-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{g.label}</h2>
                      <span className="h-px flex-1 bg-white/8" />
                      <span className="text-xs text-slate-600">{g.items.length}</span>
                    </div>
                    <ul className="relative space-y-3">
                      {/* الخط الرأسي */}
                      <span className="absolute bottom-6 left-5 top-6 w-px bg-white/8" />
                      {g.items.map((n) => (
                        <NotificationItem
                          key={n.id}
                          notification={n}
                          fresh={fresh.has(n.id)}
                          index={items.indexOf(n)}
                          onMarkRead={(id) => void handleMarkOne(id)}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <Card>
                <PaginationBar
                  page={page}
                  totalPages={pagination.totalPages}
                  total={pagination.total}
                  limit={limit}
                  disabled={loading}
                  onPage={setPage}
                  onLimit={(n) => {
                    setLimit(n)
                    resetPage()
                  }}
                />
              </Card>
            </>
          )}
        </section>
      </div>
    </PageShell>
  )
}
