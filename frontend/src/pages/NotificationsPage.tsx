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

import { useEffect, useMemo, useState } from 'react'
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
import { useTranslation } from 'react-i18next'

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
import useNotificationStore from '../store/notificationStore'
import { NOTIFICATION_TYPES, TYPE_META, type NotificationType } from '../utils/notificationMeta'
import type { AppNotification } from '../services/notificationsService'
import { cn, formatDate, formatNumber } from '../utils/format'
import NotificationItem from './notifications/NotificationItem'

/** تجميع الإشعارات حسب اليوم (Today / Yesterday / تاريخ) مع الحفاظ على الترتيب */
function groupByDay(
  items: AppNotification[],
  todayLabel: string,
  yesterdayLabel: string,
): { label: string; items: AppNotification[] }[] {
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86_400_000).toDateString()
  const map = new Map<string, AppNotification[]>()

  for (const n of items) {
    const key = new Date(n.createdAt).toDateString()
    const arr = map.get(key)
    if (arr) arr.push(n)
    else map.set(key, [n])
  }

  return Array.from(map.entries()).map(([key, list]) => ({
    label: key === today ? todayLabel : key === yesterday ? yesterdayLabel : formatDate(list[0]!.createdAt),
    items: list,
  }))
}

// ==================================================================
// Page
// ==================================================================

export default function NotificationsPage() {
  const { t } = useTranslation(['notifications', 'common'])
  const toast = useToast()

  const items = useNotificationStore((s) => s.items)
  const pagination = useNotificationStore((s) => s.pagination)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const loading = useNotificationStore((s) => s.loading)
  const loaded = useNotificationStore((s) => s.loaded)
  const error = useNotificationStore((s) => s.error)
  const connection = useNotificationStore((s) => s.connection)
  const soundEnabled = useNotificationStore((s) => s.soundEnabled)
  const freshIds = useNotificationStore((s) => s.freshIds)

  // ---------------- Filters ----------------
  const [search, setSearch] = useState('')
  const [type, setType] = useState<NotificationType | ''>('')
  const [severity, setSeverity] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const debouncedSearch = useDebounce(search)

  // ---------------- Query ----------------
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

  // ---------------- Page lifecycle: freshIds + pageOpen ----------------
  useEffect(() => {
    useNotificationStore.getState().setPageOpen(true)
    return () => {
      const store = useNotificationStore.getState()
      store.setPageOpen(false)
      store.clearFresh()
    }
  }, [])

  useEffect(() => {
    void useNotificationStore.getState().fetchList(query)
  }, [query])

  const resetPage = () => setPage(1)
  const hasFilters = Boolean(search || type || severity || unreadOnly)

  const clearFilters = () => {
    setSearch('')
    setType('')
    setSeverity('')
    setUnreadOnly(false)
    resetPage()
  }

  const handleMarkAll = async () => {
    const ok = await useNotificationStore.getState().markAllRead()
    if (ok) toast.success(t('page.markedAll'))
    else toast.error('Could not mark notifications as read')
  }

  const handleMarkOne = async (id: string) => {
    const ok = await useNotificationStore.getState().markRead(id)
    if (!ok) toast.error('Could not mark the notification as read')
  }

  const conn = useMemo(
    () => ({
      text: t(`connection.${connection}` as never),
      hint: t(`connection.${connection}Hint` as never),
    }),
    [connection, t],
  )

  const severityOptions = useMemo(
    () => [
      { value: '', label: t('filters.anySeverity') },
      { value: '2', label: t('filters.sev2') },
      { value: '3', label: t('filters.sev3') },
      { value: '4', label: t('filters.sev4') },
    ],
    [t],
  )

  const live = connection === 'connected'
  const fresh = new Set(freshIds)
  const groups = useMemo(() => groupByDay(items, t('days.today'), t('days.yesterday')), [items, t])
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
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            <Button icon={RefreshCw} loading={loading && items.length > 0} onClick={() => void useNotificationStore.getState().fetchList()}>
              {t('page.refresh')}
            </Button>
            <Button variant="primary" icon={CheckCheck} disabled={unreadCount === 0} onClick={() => void handleMarkAll()}>
              {t('page.markAllRead')}
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
                aria-label={soundEnabled ? t('page.soundOff') : t('page.soundOn')}
                title={soundEnabled ? t('page.soundOff') : t('page.soundOn')}
                onClick={() => useNotificationStore.getState().setSoundEnabled(!soundEnabled)}
              />
            </div>

            <div className="mt-4 flex items-end justify-between border-t border-white/5 pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.unreadOnly')}</p>
                {!loaded && loading ? (
                  <div className="zp-skeleton mt-1 h-8 w-12 rounded-md" />
                ) : (
                  <p className="text-3xl font-bold tracking-tight text-white">{formatNumber(unreadCount)}</p>
                )}
              </div>
              <div className="text-end">
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
              placeholder={t('page.search')}
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
                  {t('page.allTypes')}
                </button>
                {NOTIFICATION_TYPES.map((tItem) => {
                  const TypeIcon = TYPE_META[tItem].icon
                  return (
                    <button
                      key={tItem}
                      type="button"
                      className={chip(type === tItem)}
                      onClick={() => {
                        setType(type === tItem ? '' : tItem)
                        resetPage()
                      }}
                    >
                      <TypeIcon className="h-4 w-4" />
                      {TYPE_META[tItem].label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Severity</p>
              <div className="grid grid-cols-2 gap-1.5">
                {severityOptions.map((o) => (
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
              {t('page.unreadOnly')}
              <Toggle
                checked={unreadOnly}
                onChange={(v) => {
                  setUnreadOnly(v)
                  resetPage()
                }}
                label={t('page.unreadOnly')}
              />
            </label>

            {hasFilters && (
              <Button icon={X} variant="ghost" className="w-full" onClick={clearFilters}>
                {t('page.clearFilters')}
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
                title={hasFilters ? t('page.emptyTitle') : t('page.emptyTitleNone')}
                description={
                  hasFilters
                    ? t('page.emptyDesc')
                    : t('page.emptyDescNone')
                }
                action={
                  hasFilters ? (
                    <Button icon={X} onClick={clearFilters}>
                      {t('page.clearFilters')}
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
                      <span className="absolute bottom-6 start-5 top-6 w-px bg-white/8" />
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
