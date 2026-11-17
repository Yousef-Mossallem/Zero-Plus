// frontend/src/pages/SecurityEventsPage.tsx
// ==================================================================
// Zero Plus - Security Events Page
// سجل كل حدث أمني وتفاصيله (مربوط بـ backend/modules/events)
//
// اللي بتعمله الصفحة:
//   1) GET /events بفلاتر + ترتيب + Pagination (organizationId من الـ JWT)
//   2) شريط إحصائيات: الإجمالي + متوسط الخطورة + عدد BLOCK + عدد CHALLENGE
//   3) تابات للفلترة بالقرار (Allow / Monitor / Rate limit / Challenge / Block)
//   4) فتح تفاصيل الحدث (GET /events/:id) في Drawer جانبي
//   5) تحديث تلقائي اختياري كل 10 ثواني (لأن Socket.IO لسه متفعلش في الباك)
//   6) توست للأخطاء والنسخ + ربط مع صفحة Reputation
//
// i18n: كل النصوص من قسم events. رسالة توست التحميل بتتطلب عن طريق tRef
// عشان تغيير اللغة ما يعيدش تحميل الأحداث (دالة load مش بتعتمد على t).
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, Ban, Gauge, Radio, RefreshCw, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import EventsTable from '../components/EventsTable'
import { useToast } from '../components/ui/Toast'
import { TONE_ICON } from '../components/ui/tones'
import { Badge, Button, Card, ErrorState, Field, PageHeader, PageShell, PaginationBar, SelectInput, Skeleton, TextInput, Toggle, type IconType, type Tone } from '../components/ui/kit'
import { useDebounce } from '../hooks/useDebounce'
import { parseApiError } from '../services/apiError'
import { getEvents, type EventSortBy, type EventsQuery, type HttpMethod, type SecurityEvent } from '../services/eventsService'
import { listServers, type Server } from '../services/serversService'
import type { IpType } from '../services/types'
import { cn, formatNumber, localInputToIso } from '../utils/format'
import { EventDrawer } from './events/EventDrawer'

/** التحديث التلقائي (كان ناقص ومتعرّفش، وكان بيكسر زرار Live) */
const AUTO_REFRESH_MS = 10_000

// ==================================================================
// Filters helpers
// ==================================================================

type Filters = {
  search: string
  decision: string
  serverId: string
  method: string
  ipType: string
  isChallenged: string
  minRisk: string
  maxRisk: string
  startDate: string
  endDate: string
  reputationEntryId: string
}

const EMPTY_FILTERS: Filters = {
  search: '',
  decision: '',
  serverId: '',
  method: '',
  ipType: '',
  isChallenged: '',
  minRisk: '',
  maxRisk: '',
  startDate: '',
  endDate: '',
  reputationEntryId: '',
}

function parseRisk(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined
  return n
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const
const IP_TYPES = ['RESIDENTIAL', 'MOBILE', 'DATACENTER', 'VPN_PROXY', 'TOR', 'UNKNOWN'] as const

// تابات القرار: المفتاح بيتترجم (decision.<key>) والنقطة لون
const DECISION_TABS = [
  { value: '', key: 'all', dot: 'bg-cyan-400' },
  { value: 'ALLOW', key: 'ALLOW', dot: 'bg-emerald-400' },
  { value: 'MONITOR', key: 'MONITOR', dot: 'bg-sky-400' },
  { value: 'RATE_LIMIT', key: 'RATE_LIMIT', dot: 'bg-amber-400' },
  { value: 'CHALLENGE', key: 'CHALLENGE', dot: 'bg-indigo-400' },
  { value: 'BLOCK', key: 'BLOCK', dot: 'bg-rose-400' },
] as const

function riskBar(score: number): string {
  if (score >= 80) return 'bg-rose-400'
  if (score >= 60) return 'bg-orange-400'
  if (score >= 31) return 'bg-amber-400'
  return 'bg-emerald-400'
}

// ==================================================================
// خلية إحصائية داخل الشريط
// ==================================================================

function Metric({
  label,
  value,
  icon: Icon,
  tone,
  hint,
  loading,
  children,
}: {
  label: string
  value: string
  icon: IconType
  tone: Tone
  hint?: string
  loading: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="min-w-0 p-5">
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone])}>
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-20 rounded-md" />
      ) : (
        <p className="mt-2 truncate text-3xl font-bold tracking-tight tabular-nums text-white">{value}</p>
      )}
      {children}
      {hint && !loading && <p className="mt-1 truncate text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

// ==================================================================
// Page
// ==================================================================

export default function SecurityEventsPage() {
  const toast = useToast()
  const { t } = useTranslation('events')
  const [searchParams, setSearchParams] = useSearchParams()

  // نسخة ثابتة من t لاستخدامها جوه load من غير ما تتسبب في إعادة التحميل
  const tRef = useRef(t)
  tRef.current = t

  // مفاتيح ديناميكية (نوع IP) فبنستخدم نسخة غير مقيّدة بالأنواع
  const ts = t as unknown as (key: string, opts?: object) => string

  // ---------------- Filters / paging / sorting ----------------
  // ممكن نيجي من صفحات تانية بـ ?ip=1.2.3.4 أو ?entry=<reputationEntryId>
  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    search: searchParams.get('ip') ?? '',
    reputationEntryId: searchParams.get('entry') ?? '',
  }))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [sortBy, setSortBy] = useState<EventSortBy>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // الحقول اللي بيكتب فيها المستخدم بتتأخر شوية قبل ما نبعت request
  const debouncedSearch = useDebounce(filters.search)
  const debouncedMin = useDebounce(filters.minRisk)
  const debouncedMax = useDebounce(filters.maxRisk)

  // ---------------- Data ----------------
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 })
  const [summary, setSummary] = useState({ totalEvents: 0, averageRiskScore: 0 })
  const [counts, setCounts] = useState<{ block: number | null; challenge: number | null }>({
    block: null,
    challenge: null,
  })
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [selected, setSelected] = useState<SecurityEvent | null>(null)

  // بيمنع رد قديم (متأخر) إنه يكتب فوق رد أحدث
  const requestId = useRef(0)

  // ---------------- Build query ----------------
  // الفلاتر المشتركة (من غير decision/paging/sort) عشان نستخدمها في العدّادات كمان
  const baseQuery = useMemo<EventsQuery>(() => {
    const min = parseRisk(debouncedMin)
    const max = parseRisk(debouncedMax)
    const start = localInputToIso(filters.startDate)
    const end = localInputToIso(filters.endDate)

    return {
      ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
      ...(filters.serverId && { serverId: filters.serverId }),
      ...(filters.method && { method: filters.method as HttpMethod }),
      ...(filters.ipType && { ipType: filters.ipType as IpType }),
      ...(min !== undefined && { minRiskScore: min }),
      ...(max !== undefined && { maxRiskScore: max }),
      ...(start && { startDate: start }),
      ...(end && { endDate: end }),
      ...(filters.isChallenged && { isChallenged: filters.isChallenged === 'true' }),
      ...(filters.reputationEntryId && { reputationEntryId: filters.reputationEntryId }),
    }
  }, [
    debouncedSearch,
    debouncedMin,
    debouncedMax,
    filters.serverId,
    filters.method,
    filters.ipType,
    filters.startDate,
    filters.endDate,
    filters.isChallenged,
    filters.reputationEntryId,
  ])

  const query = useMemo<EventsQuery>(
    () => ({
      ...baseQuery,
      ...(filters.decision && { decision: filters.decision as EventsQuery['decision'] }),
      page,
      limit,
      sortBy,
      sortOrder,
    }),
    [baseQuery, filters.decision, page, limit, sortBy, sortOrder],
  )

  // ---------------- Load events ----------------
  // silent=true للتحديث التلقائي: مفيش skeleton ولا توست متكرر
  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current
      if (!silent) setLoading(true)
      try {
        const res = await getEvents(query)
        if (id !== requestId.current) return
        setEvents(res.events)
        setPagination({ total: res.pagination.total, totalPages: res.pagination.totalPages })
        setSummary(res.summary)
        setError(null)
      } catch (err) {
        if (id !== requestId.current) return
        const { message } = parseApiError(err)
        // في التحديث الصامت منزعجش المستخدم لو فيه بيانات معروضة أصلاً
        if (!silent || events.length === 0) {
          setError(message)
          toast.error(tRef.current('toast.loadFailed'), message)
        }
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    // events.length عمدًا مش في الـ deps عشان مايعملش loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  // ---------------- Counters (BLOCK / CHALLENGE) ----------------
  // طلبين خفيفين (limit=1): بناخد منهم pagination.total بس
  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      getEvents({ ...baseQuery, decision: 'BLOCK', page: 1, limit: 1 }),
      getEvents({ ...baseQuery, decision: 'CHALLENGE', page: 1, limit: 1 }),
    ]).then(([block, challenge]) => {
      if (cancelled) return
      setCounts({
        block: block.status === 'fulfilled' ? block.value.pagination.total : null,
        challenge: challenge.status === 'fulfilled' ? challenge.value.pagination.total : null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [baseQuery])

  // ---------------- Servers dropdown ----------------
  useEffect(() => {
    listServers({ limit: 100, sortBy: 'domain', sortOrder: 'asc' })
      .then((res) => setServers(res.data))
      .catch(() => {
        /* الفلتر اختياري، الصفحة تشتغل من غيره */
      })
  }, [])

  // ---------------- Auto refresh ----------------
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => void load(true), AUTO_REFRESH_MS)
    return () => clearInterval(timer)
  }, [live, load])

  // ---------------- Handlers ----------------
  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1) // أي فلتر جديد يرجعنا لأول صفحة
  }

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS)
    setPage(1)
    if (searchParams.size > 0) setSearchParams({}, { replace: true })
  }

  const handleSort = (field: EventSortBy) => {
    if (field === sortBy) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder(field === 'ipAddress' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  const hasActiveFilters = Object.values(filters).some((v) => v !== '')
  const minInvalid = filters.minRisk !== '' && parseRisk(filters.minRisk) === undefined
  const maxInvalid = filters.maxRisk !== '' && parseRisk(filters.maxRisk) === undefined
  const firstLoad = loading && events.length === 0

  // النسبة من الإجمالي بتبان بس لما مفيش فلتر قرار (لأن الإجمالي ساعتها بيتأثر بالقرار)
  const share = (n: number | null): string | undefined =>
    n !== null && !filters.decision && summary.totalEvents > 0
      ? t('stats.share', { pct: ((n / summary.totalEvents) * 100).toFixed(1) })
      : undefined

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={ShieldAlert}
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            <label className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/3 px-3.5 py-2 text-sm text-slate-300">
              <span className="relative flex h-2.5 w-2.5">
                {live && <span className="zp-anim-pulse-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400" />}
                <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', live ? 'bg-emerald-400' : 'bg-slate-600')} />
              </span>
              <Radio className={cn('h-4 w-4', live ? 'text-emerald-400' : 'text-slate-500')} />
              {t('page.live')}
              <Toggle checked={live} onChange={setLive} label={t('page.liveLabel')} />
            </label>
            <Button
              icon={RefreshCw}
              loading={loading && events.length > 0}
              onClick={() => void load()}
            >
              {t('page.refresh')}
            </Button>
          </>
        }
      />

      {/* ---------- شريط الإحصائيات ---------- */}
      <Card accent delay={60}>
        <div className="grid grid-cols-2 divide-white/6 lg:grid-cols-4 lg:divide-x [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-white/6 lg:[&>*:nth-child(n+3)]:border-t-0">
          <Metric
            label={t('stats.total')}
            value={formatNumber(summary.totalEvents)}
            icon={Activity}
            tone="cyan"
            hint={hasActiveFilters ? t('stats.matching') : t('stats.allTime')}
            loading={firstLoad}
          />
          <Metric
            label={t('stats.avgRisk')}
            value={summary.averageRiskScore.toFixed(1)}
            icon={Gauge}
            tone="amber"
            loading={firstLoad}
          >
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div
                className={cn('zp-anim-bar h-full rounded-full', riskBar(summary.averageRiskScore))}
                style={{ width: `${Math.min(100, summary.averageRiskScore)}%` }}
              />
            </div>
          </Metric>
          <Metric
            label={t('stats.blocked')}
            value={formatNumber(counts.block)}
            icon={Ban}
            tone="rose"
            hint={share(counts.block)}
            loading={counts.block === null}
          />
          <Metric
            label={t('stats.challenged')}
            value={formatNumber(counts.challenge)}
            icon={ShieldCheck}
            tone="indigo"
            hint={share(counts.challenge)}
            loading={counts.challenge === null}
          />
        </div>
      </Card>

      {/* ---------- تابات القرار ---------- */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {DECISION_TABS.map((tab) => {
          const active = filters.decision === tab.value
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => updateFilter('decision', tab.value)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition',
                active
                  ? 'border-cyan-400/40 bg-cyan-500/15 text-white shadow-lg shadow-cyan-500/10'
                  : 'border-white/10 bg-white/3 text-slate-400 hover:border-white/20 hover:text-white',
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', tab.dot)} />
              {t(`decision.${tab.key}` as never)}
            </button>
          )
        })}
      </div>

      {/* ---------- Filters ---------- */}
      <Card className="p-5" delay={120}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <TextInput
              icon={Search}
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              placeholder={t('filters.search')}
            />
          </div>

          <SelectInput
            value={filters.serverId}
            onChange={(e) => updateFilter('serverId', e.target.value)}
            className="lg:w-56"
          >
            <option value="">{t('filters.allServers')}</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0b1224]">
                {s.domain}
              </option>
            ))}
          </SelectInput>

          <div className="flex gap-2">
            <Button
              icon={SlidersHorizontal}
              variant={showAdvanced ? 'primary' : 'outline'}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {t('filters.more')}
            </Button>
            {hasActiveFilters && (
              <Button icon={X} variant="ghost" onClick={resetFilters}>
                {t('filters.clear')}
              </Button>
            )}
          </div>
        </div>

        {/* فلاتر متقدمة */}
        {showAdvanced && (
          <div className="zp-anim-fade-in mt-5 grid grid-cols-1 gap-4 border-t border-white/6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('filters.method')}>
              <SelectInput value={filters.method} onChange={(e) => updateFilter('method', e.target.value)}>
                <option value="">{t('filters.any')}</option>
                {METHODS.map((m) => (
                  <option key={m} value={m} className="bg-[#0b1224]">
                    {m}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label={t('filters.ipType')}>
              <SelectInput value={filters.ipType} onChange={(e) => updateFilter('ipType', e.target.value)}>
                <option value="">{t('filters.any')}</option>
                {IP_TYPES.map((ip) => (
                  <option key={ip} value={ip} className="bg-[#0b1224]">
                    {ts(`ipTypes.${ip}`)}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label={t('filters.challenge')}>
              <SelectInput
                value={filters.isChallenged}
                onChange={(e) => updateFilter('isChallenged', e.target.value)}
              >
                <option value="">{t('filters.any')}</option>
                <option value="true" className="bg-[#0b1224]">{t('filters.challenged')}</option>
                <option value="false" className="bg-[#0b1224]">{t('filters.notChallenged')}</option>
              </SelectInput>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('filters.minRisk')} error={minInvalid ? t('filters.range') : undefined}>
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  value={filters.minRisk}
                  invalid={minInvalid}
                  onChange={(e) => updateFilter('minRisk', e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label={t('filters.maxRisk')} error={maxInvalid ? t('filters.range') : undefined}>
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  value={filters.maxRisk}
                  invalid={maxInvalid}
                  onChange={(e) => updateFilter('maxRisk', e.target.value)}
                  placeholder="100"
                />
              </Field>
            </div>

            <Field label={t('filters.from')}>
              <TextInput
                type="datetime-local"
                value={filters.startDate}
                onChange={(e) => updateFilter('startDate', e.target.value)}
              />
            </Field>

            <Field label={t('filters.to')}>
              <TextInput
                type="datetime-local"
                value={filters.endDate}
                onChange={(e) => updateFilter('endDate', e.target.value)}
              />
            </Field>

            {filters.reputationEntryId && (
              <div className="flex items-end sm:col-span-2">
                <Badge tone="cyan" className="normal-case">
                  {t('filters.repFilter')}
                  <button
                    type="button"
                    onClick={() => updateFilter('reputationEntryId', '')}
                    className="ms-1 hover:text-white"
                    aria-label={t('filters.removeRepFilter')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ---------- Table ---------- */}
      <Card delay={200}>
        {error && events.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <>
            <EventsTable
              events={events}
              loading={loading}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
              onRowClick={setSelected}
              emptyAction={
                hasActiveFilters ? (
                  <Button icon={X} onClick={resetFilters}>
                    {t('filters.clearFilters')}
                  </Button>
                ) : undefined
              }
            />

            {(pagination.total > 0 || loading) && (
              <PaginationBar
                page={page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                limit={limit}
                disabled={loading}
                onPage={setPage}
                onLimit={(n) => {
                  setLimit(n)
                  setPage(1)
                }}
              />
            )}
          </>
        )}
      </Card>

      <EventDrawer event={selected} onClose={() => setSelected(null)} />
    </PageShell>
  )
}
