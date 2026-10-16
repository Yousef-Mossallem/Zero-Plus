// frontend/src/pages/SecurityEventsPage.tsx
// ==================================================================
// Zero Plus - Security Events Page
// سجل كل حدث أمني وتفاصيله (مربوط بـ backend/modules/events)
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, Ban, Gauge, Radio, RefreshCw, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import EventsTable from '../components/EventsTable'
import { useToast } from '../components/ui/Toast'
import { Badge, Button, Card, ErrorState, Field, PageHeader, PageShell, PaginationBar, SelectInput, StatCard, TextInput, Toggle } from '../components/ui/kit'
import { useDebounce } from '../hooks/useDebounce'
import { parseApiError } from '../services/apiError'
import { getEvents, type EventSortBy, type EventsQuery, type HttpMethod, type SecurityEvent } from '../services/eventsService'
import { listServers, type Server } from '../services/serversService'
import type { Decision, IpType } from '../services/types'
import { formatNumber, localInputToIso } from '../utils/format'
import { EventDrawer } from './events/EventDrawer'

// ==================================================================
// المتغيرات والأنواع الناقصة (كانت مفقودة وتم إضافتها هنا)
// ==================================================================

const AUTO_REFRESH_MS = 10_000

const DECISIONS: Exclude<Decision, 'MONITOR'>[] = ['ALLOW', 'RATE_LIMIT', 'CHALLENGE', 'BLOCK']

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']

const IP_TYPES: IpType[] = ['RESIDENTIAL', 'MOBILE', 'DATACENTER', 'VPN_PROXY', 'TOR', 'UNKNOWN']

interface Filters {
  search: string
  decision: string
  serverId: string
  method: string
  ipType: string
  minRisk: string
  maxRisk: string
  startDate: string
  endDate: string
  isChallenged: string
  reputationEntryId: string
}

const EMPTY_FILTERS: Filters = {
  search: '',
  decision: '',
  serverId: '',
  method: '',
  ipType: '',
  minRisk: '',
  maxRisk: '',
  startDate: '',
  endDate: '',
  isChallenged: '',
  reputationEntryId: '',
}

function parseRisk(value: string): number | undefined {
  if (!value.trim()) return undefined
  const num = Number(value)
  return isNaN(num) || num < 0 || num > 100 ? undefined : num
}

// ==================================================================
// Page
// ==================================================================

export default function SecurityEventsPage() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  // ---------------- Filters / paging / sorting ----------------
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
        if (!silent || events.length === 0) {
          setError(message)
          toast.error('Failed to load security events', message)
        }
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  // ---------------- Counters (BLOCK / CHALLENGE) ----------------
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
    setPage(1)
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

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={ShieldAlert}
        title="Security Events"
        subtitle="Every request the Gateway inspected, with the decision and the reasons behind it."
        actions={
          <>
            <label className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/3 px-3.5 py-2 text-sm text-slate-300">
              <Radio className={`h-4 w-4 ${live ? 'text-emerald-400' : 'text-slate-500'}`} />
              Live
              <Toggle checked={live} onChange={setLive} label="Auto refresh every 10 seconds" />
            </label>
            <Button icon={RefreshCw} loading={loading && events.length > 0} onClick={() => void load()}>
              Refresh
            </Button>
          </>
        }
      />

      {/* ---------- Stats ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total events"
          value={formatNumber(summary.totalEvents)}
          icon={Activity}
          tone="cyan"
          hint={hasActiveFilters ? 'Matching current filters' : 'All time'}
          loading={loading && events.length === 0}
          delay={0}
        />
        <StatCard
          label="Average risk"
          value={summary.averageRiskScore.toFixed(1)}
          icon={Gauge}
          tone="amber"
          hint="Out of 100"
          loading={loading && events.length === 0}
          delay={60}
        />
        <StatCard
          label="Blocked"
          value={formatNumber(counts.block)}
          icon={Ban}
          tone="rose"
          loading={counts.block === null}
          delay={120}
        />
        <StatCard
          label="Challenged"
          value={formatNumber(counts.challenge)}
          icon={ShieldCheck}
          tone="indigo"
          loading={counts.challenge === null}
          delay={180}
        />
      </div>

      {/* ---------- Filters ---------- */}
      <Card className="p-5" delay={120} accent>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <TextInput
              icon={Search}
              value={filters.search}
              onChange={(e) => updateFilter('search', e.target.value)}
              placeholder="Search IP, path, user agent, request ID, reason…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:flex">
            <SelectInput
              value={filters.decision}
              onChange={(e) => updateFilter('decision', e.target.value)}
              className="lg:w-40"
            >
              <option value="">All decisions</option>
              {DECISIONS.map((d) => (
                <option key={d} value={d} className="bg-[#0b1224]">
                  {d.replace('_', ' ')}
                </option>
              ))}
            </SelectInput>

            <SelectInput
              value={filters.serverId}
              onChange={(e) => updateFilter('serverId', e.target.value)}
              className="lg:w-48"
            >
              <option value="">All servers</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#0b1224]">
                  {s.domain}
                </option>
              ))}
            </SelectInput>
          </div>

          <div className="flex gap-2">
            <Button
              icon={SlidersHorizontal}
              variant={showAdvanced ? 'primary' : 'outline'}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              More
            </Button>
            {hasActiveFilters && (
              <Button icon={X} variant="ghost" onClick={resetFilters}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* فلاتر متقدمة */}
        {showAdvanced && (
          <div className="zp-anim-fade-in mt-5 grid grid-cols-1 gap-4 border-t border-white/6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Method">
              <SelectInput value={filters.method} onChange={(e) => updateFilter('method', e.target.value)}>
                <option value="">Any</option>
                {METHODS.map((m) => (
                  <option key={m} value={m} className="bg-[#0b1224]">
                    {m}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="IP type">
              <SelectInput value={filters.ipType} onChange={(e) => updateFilter('ipType', e.target.value)}>
                <option value="">Any</option>
                {IP_TYPES.map((t) => (
                  <option key={t} value={t} className="bg-[#0b1224]">
                    {t.replace('_', ' / ')}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field label="Challenge">
              <SelectInput
                value={filters.isChallenged}
                onChange={(e) => updateFilter('isChallenged', e.target.value)}
              >
                <option value="">Any</option>
                <option value="true" className="bg-[#0b1224]">Challenged</option>
                <option value="false" className="bg-[#0b1224]">Not challenged</option>
              </SelectInput>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Min risk" error={minInvalid ? '0–100' : undefined}>
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
              <Field label="Max risk" error={maxInvalid ? '0–100' : undefined}>
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

            <Field label="From">
              <TextInput
                type="datetime-local"
                value={filters.startDate}
                onChange={(e) => updateFilter('startDate', e.target.value)}
              />
            </Field>
            <Field label="To">
              <TextInput
                type="datetime-local"
                value={filters.endDate}
                onChange={(e) => updateFilter('endDate', e.target.value)}
              />
            </Field>

            {filters.reputationEntryId && (
              <div className="flex items-end sm:col-span-2">
                <Badge tone="cyan" className="normal-case">
                  Filtered by reputation entry
                  <button
                    type="button"
                    onClick={() => updateFilter('reputationEntryId', '')}
                    className="ml-1 hover:text-white"
                    aria-label="Remove reputation filter"
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
                    Clear filters
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