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
  Inbox,
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
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  PaginationBar,
  SelectInput,
  Skeleton,
  StatCard,
  TextInput,
  Toggle,
} from '../components/ui/kit'
import { useDebounce } from '../hooks/useDebounce'
import type { NotificationsQuery } from '../services/notificationsService'
import useNotificationStore, { type ConnectionStatus } from '../store/notificationStore'
import { NOTIFICATION_TYPES, TYPE_META, type NotificationType } from '../utils/notificationMeta'
import { formatNumber } from '../utils/format'
import NotificationItem from './notifications/NotificationItem'

const CONNECTION_LABEL: Record<ConnectionStatus, { text: string; hint: string }> = {
  connected: { text: 'Live', hint: 'Real-time updates are on' },
  connecting: { text: 'Connecting…', hint: 'Reaching the server' },
  disconnected: { text: 'Offline', hint: 'Retrying automatically' },
  unauthorized: { text: 'Signed out', hint: 'Session rejected by the socket' },
  idle: { text: 'Idle', hint: 'Not connected' },
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

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={Bell}
        title="Notifications"
        subtitle="Security alerts and system updates for your organization, in real time."
        actions={
          <>
            <Badge tone={live ? 'emerald' : connection === 'connecting' ? 'amber' : 'rose'} dot>
              {conn.text}
            </Badge>
            <Button
              icon={soundEnabled ? Volume2 : VolumeX}
              onClick={() => useNotificationStore.getState().setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Mute notification sound' : 'Unmute notification sound'}
            >
              {soundEnabled ? 'Sound on' : 'Muted'}
            </Button>
            <Button icon={RefreshCw} loading={loading && items.length > 0} onClick={() => void useNotificationStore.getState().fetchList()}>
              Refresh
            </Button>
            <Button variant="primary" icon={CheckCheck} disabled={unreadCount === 0} onClick={() => void handleMarkAll()}>
              Mark all read
            </Button>
          </>
        }
      />

      {/* ---------- Stats ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Unread" value={formatNumber(unreadCount)} icon={BellRing} tone="rose" loading={!loaded && loading} delay={0} />
        <StatCard
          label={hasFilters ? 'Matching' : 'Total'}
          value={formatNumber(pagination.total)}
          icon={Inbox}
          tone="cyan"
          loading={!loaded && loading}
          delay={60}
        />
        <StatCard
          label="Live updates"
          value={conn.text}
          icon={live ? Radio : WifiOff}
          tone={live ? 'emerald' : 'amber'}
          hint={conn.hint}
          delay={120}
        />
      </div>

      {/* ---------- Filters ---------- */}
      <Card className="p-5" delay={120} accent>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <TextInput
              icon={Search}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                resetPage()
              }}
              placeholder="Search title or message…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:flex">
            <SelectInput
              value={type}
              onChange={(e) => {
                setType(e.target.value)
                resetPage()
              }}
              className="lg:w-52"
            >
              <option value="">All types</option>
              {NOTIFICATION_TYPES.map((t) => (
                <option key={t} value={t} className="bg-[#0b1224]">
                  {TYPE_META[t].label}
                </option>
              ))}
            </SelectInput>

            <SelectInput
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value)
                resetPage()
              }}
              className="lg:w-40"
            >
              <option value="">Any severity</option>
              <option value="2" className="bg-[#0b1224]">Notice +</option>
              <option value="3" className="bg-[#0b1224]">Important +</option>
              <option value="4" className="bg-[#0b1224]">Critical +</option>
            </SelectInput>
          </div>

          <label className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/3 px-3.5 py-2 text-sm text-slate-300">
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
            <Button icon={X} variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </Card>

      {/* ---------- List ---------- */}
      <Card delay={200}>
        {error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => void useNotificationStore.getState().fetchList()} />
        ) : loading && items.length === 0 ? (
          <div className="space-y-px p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4 px-3 py-4">
                <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3.5 w-full max-w-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
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
        ) : (
          <>
            <ul className={loading ? 'opacity-60' : undefined}>
              {items.map((n, i) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  fresh={fresh.has(n.id)}
                  index={i}
                  onMarkRead={(id) => void handleMarkOne(id)}
                />
              ))}
            </ul>
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
          </>
        )}
      </Card>
    </PageShell>
  )
}
