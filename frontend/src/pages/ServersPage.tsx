// frontend/src/pages/ServersPage.tsx
// ==================================================================
// Zero Plus - Servers Page
// Manage protected servers (wired to backend/modules/servers)
//
//   GET    /servers                 → list + pagination + summary (count per status)
//   POST   /servers                 → add server (returns DNS instructions)
//   GET    /servers/:id             → details incl. capacity/probe fields (drawer)
//   PATCH  /servers/:id             → edit (origin change resets probe numbers)
//   GET    /servers/:id/dns         → DNS instructions + verification state
//   POST   /servers/:id/verify      → verify (ownership | routing | all)
//   POST   /servers/:id/probe       → 202, re-measure capacity (OWNER/ADMIN)
//   POST   /servers/:id/maintenance → toggle maintenance mode
//   DELETE /servers/:id?confirmDomain= → delete (type the domain to confirm)
//
// Socket: server:status → merges live status + capacity fields into the list.
// Fallback: silent polling (45s, or 15s while a measurement is running).
//
// Permissions: add/edit/delete/verify/probe/maintenance = OWNER or ADMIN only.
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
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
import { useDebounce } from '../hooks/useDebounce'
import { getSocket } from '../services/socket'
import {
  getApiErrorInfo,
  listServers,
  mergeServerStatusEvent,
  requestProbe,
  setMaintenance,
  type DnsInstructions,
  type DnsVerificationResult,
  type Server,
  type ServersQuery,
  type ServerStatusEvent,
} from '../services/serversService'
import type { ServerMode, ServerStatus } from '../services/types'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { cn, timeAgo } from '../utils/format'
import { MANAGE_ROLES, PAGE_SIZE, STATUS_META } from './servers/shared'
import { ServerFormModal } from './servers/ServerFormModal'
import { DnsModal } from './servers/DnsModal'
import { DeleteModal } from './servers/DeleteModal'
import { ServerCard } from './servers/ServerCard'
import ServerDetailDrawer from './servers/ServerDetailDrawer'

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const STATUS_ORDER: ServerStatus[] = ['ONLINE', 'DEGRADED', 'OFFLINE', 'PENDING', 'MAINTENANCE']

const STATUS_BAR: Record<ServerStatus, string> = {
  ONLINE: 'bg-emerald-400',
  DEGRADED: 'bg-amber-400',
  OFFLINE: 'bg-rose-500',
  PENDING: 'bg-slate-500',
  MAINTENANCE: 'bg-indigo-400',
}

type SortKey = 'newest' | 'oldest' | 'updated' | 'domain-asc' | 'domain-desc' | 'status'

const SORT_OPTIONS: {
  value: SortKey
  labelKey: 'page.sort.newest' | 'page.sort.oldest' | 'page.sort.updated' | 'page.sort.domainAsc' | 'page.sort.domainDesc' | 'page.sort.status'
  sortBy: NonNullable<ServersQuery['sortBy']>
  sortOrder: 'asc' | 'desc'
}[] = [
  { value: 'newest', labelKey: 'page.sort.newest', sortBy: 'createdAt', sortOrder: 'desc' },
  { value: 'oldest', labelKey: 'page.sort.oldest', sortBy: 'createdAt', sortOrder: 'asc' },
  { value: 'updated', labelKey: 'page.sort.updated', sortBy: 'updatedAt', sortOrder: 'desc' },
  { value: 'domain-asc', labelKey: 'page.sort.domainAsc', sortBy: 'domain', sortOrder: 'asc' },
  { value: 'domain-desc', labelKey: 'page.sort.domainDesc', sortBy: 'domain', sortOrder: 'desc' },
  { value: 'status', labelKey: 'page.sort.status', sortBy: 'status', sortOrder: 'asc' },
]

/** The backend says ~2 minutes for a measurement; we show "measuring" for up to 150s */
const PROBE_WAIT_MS = 150_000
const POLL_IDLE_MS = 45_000
const POLL_PROBING_MS = 15_000
const SOCKET_RELOAD_DEBOUNCE_MS = 600

/** Minimal shape we need from the socket client (socket.io compatible) */
interface SocketLike {
  on: (event: string, handler: (payload: ServerStatusEvent) => void) => unknown
  off: (event: string, handler: (payload: ServerStatusEvent) => void) => unknown
}

function isNewer(value: string | null | undefined, base: string | null): boolean {
  if (!value) return false
  if (!base) return true
  return Date.parse(value) > Date.parse(base)
}

// ==================================================================
// Page
// ==================================================================

export default function ServersPage() {
  const { t, i18n } = useTranslation(['servers', 'common'])
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const role = useAuthStore(selectUserRole)
  const canManage = role !== null && MANAGE_ROLES.includes(role)

  const fmtInt = useCallback(
    (n: number) =>
      n.toLocaleString(
        i18n.language.startsWith('ar') ? 'ar-EG' : i18n.language.startsWith('de') ? 'de-DE' : 'en-US',
      ),
    [i18n.language],
  )

  // ---------------- Filters ----------------
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('')
  const [dnsFilter, setDnsFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search)

  // ---------------- Data ----------------
  const [servers, setServers] = useState<Server[]>([])
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 })
  const [summary, setSummary] = useState<Record<ServerStatus, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const requestId = useRef(0)

  const serversRef = useRef<Server[]>([])
  useEffect(() => {
    serversRef.current = servers
  }, [servers])

  // ---------------- Modals / Drawer ----------------
  const [formState, setFormState] = useState<{ open: boolean; server: Server | null }>({ open: false, server: null })
  const [dnsState, setDnsState] = useState<{ server: Server; dns: DnsInstructions | null } | null>(null)
  const [deleting, setDeleting] = useState<Server | null>(null)
  const [detail, setDetail] = useState<Server | null>(null)

  // ---------------- Probing (capacity measurement) ----------------
  const [probingIds, setProbingIds] = useState<Set<string>>(new Set())
  /** serverId → lastProbeAt at the moment the measurement started */
  const probeStartedWith = useRef<Map<string, string | null>>(new Map())
  const probeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const stopProbing = useCallback((id: string) => {
    const timer = probeTimers.current.get(id)
    if (timer) clearTimeout(timer)
    probeTimers.current.delete(id)
    probeStartedWith.current.delete(id)
    setProbingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const startProbing = useCallback(
    (id: string, startedWith: string | null) => {
      const old = probeTimers.current.get(id)
      if (old) clearTimeout(old)

      probeStartedWith.current.set(id, startedWith)
      setProbingIds((prev) => new Set(prev).add(id))

      probeTimers.current.set(
        id,
        setTimeout(() => {
          if (!probeStartedWith.current.has(id)) return
          stopProbing(id)
          toastRef.current.info(
            t('toast.measureSlow'),
            t('toast.measureSlowDesc'),
          )
        }, PROBE_WAIT_MS),
      )
    },
    [stopProbing, t],
  )

  // Clear timers on unmount
  useEffect(() => {
    const timers = probeTimers.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  // A measurement is finished when lastProbeAt becomes newer than when it started
  useEffect(() => {
    for (const [id, startedWith] of Array.from(probeStartedWith.current.entries())) {
      const s = servers.find((x) => x.id === id)
      if (s && isNewer(s.lastProbeAt, startedWith)) {
        stopProbing(id)
        toastRef.current.success(t('toast.measureDone'), s.domain)
      }
    }
  }, [servers, stopProbing, t])

  // ---------------- Load ----------------
  const sortOption = SORT_OPTIONS.find((o) => o.value === sort) ?? SORT_OPTIONS[0]!

  const query = useMemo<ServersQuery>(
    () => ({
      page,
      limit: PAGE_SIZE,
      sortBy: sortOption.sortBy,
      sortOrder: sortOption.sortOrder,
      ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
      ...(status && { status: status as ServerStatus }),
      ...(mode && { mode: mode as ServerMode }),
      ...(dnsFilter && { dnsVerified: dnsFilter === 'true' }),
    }),
    [page, sortOption, debouncedSearch, status, mode, dnsFilter],
  )

  /** silent = background refresh: no loading state, no error toast */
  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current
      if (!silent) setLoading(true)
      try {
        const res = await listServers(query)
        if (id !== requestId.current) return

        // Deleted the last item on a page > 1 → go back one page
        if (res.data.length === 0 && query.page && query.page > 1) {
          setPage((p) => Math.max(1, p - 1))
          return
        }

        setServers(res.data)
        setPagination({ total: res.pagination.total, totalPages: res.pagination.totalPages })
        setSummary(res.summary)
        setLastSyncedAt(new Date().toISOString())
        setError(null)
      } catch (err) {
        if (id !== requestId.current) return
        const { message } = getApiErrorInfo(err)
        if (!silent) {
          setError(message)
          toastRef.current.error(t('toast.loadFailed'), message)
        }
      } finally {
        if (id === requestId.current && !silent) setLoading(false)
      }
    },
    [query, t],
  )

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    void load()
  }, [load])

  // Fallback polling (visible tab only). Faster while a measurement is running.
  const anyProbing = probingIds.size > 0
  useEffect(() => {
    const ms = anyProbing ? POLL_PROBING_MS : POLL_IDLE_MS
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadRef.current(true)
    }, ms)
    return () => clearInterval(timer)
  }, [anyProbing])

  // ---------------- Socket: server:status ----------------
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => void loadRef.current(true), SOCKET_RELOAD_DEBOUNCE_MS)
  }, [])

  useEffect(
    () => () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
    },
    [],
  )

  const handleSocketEvent = useCallback(
    (e: ServerStatusEvent) => {
      if (e.action === 'deleted') {
        setServers((prev) => prev.filter((s) => s.id !== e.id))
        setDnsState((prev) => (prev?.server.id === e.id ? null : prev))
        setDetail((prev) => (prev?.id === e.id ? null : prev))
        stopProbing(e.id)
        scheduleReload()
        return
      }

      // Merge the live fields (status + capacity) into the card
      setServers((prev) => prev.map((s) => (s.id === e.id ? mergeServerStatusEvent(s, e) : s)))

      // Counts / filters / pagination can change on these actions
      if (e.action !== 'updated') scheduleReload()
    },
    [scheduleReload, stopProbing],
  )

  useEffect(() => {
    const socket = getSocket() as SocketLike | null
    if (!socket) return
    socket.on('server:status', handleSocketEvent)
    return () => {
      socket.off('server:status', handleSocketEvent)
    }
  }, [handleSocketEvent])

  // ---------------- Helpers ----------------
  const hasFilters = Boolean(search || status || mode || dnsFilter)
  const clearFilters = () => {
    setSearch('')
    setStatus('')
    setMode('')
    setDnsFilter('')
    setPage(1)
  }

  const replaceServer = (updated: Server) =>
    setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))

  /** Always show the freshest copy (kept live by the Socket) inside modals/drawer */
  const liveServer = (snap: Server | null): Server | null =>
    snap ? (servers.find((s) => s.id === snap.id) ?? snap) : null

  const dnsServer = liveServer(dnsState?.server ?? null)
  const detailServer = liveServer(detail)

  // ---------------- Actions ----------------
  const handleMaintenance = async (server: Server) => {
    const enable = server.status !== 'MAINTENANCE'
    setBusyId(server.id)
    try {
      const res = await setMaintenance(server.id, enable)
      replaceServer(res.data)
      toast.success(res.message)
      void load(true) // summary changes
    } catch (err) {
      toast.error(t('toast.maintenanceFailed'), getApiErrorInfo(err).message)
    } finally {
      setBusyId(null)
    }
  }

  /** Re-measure capacity: POST /probe → 202, the numbers arrive via Socket / polling */
  const handleProbe = async (server: Server) => {
    if (probingIds.has(server.id)) return

    if (!server.dnsVerified) {
      toast.info(t('toast.verifyFirst'), t('toast.verifyFirstDesc'))
      setDnsState({ server, dns: null })
      return
    }

    try {
      const res = await requestProbe(server.id)
      startProbing(server.id, server.lastProbeAt)
      toast.info(t('toast.measureStarted'), res.message)
    } catch (err) {
      const { status: httpStatus, code, message, retryAfterSec } = getApiErrorInfo(err)
      if (httpStatus === 409 || code === 'OWNERSHIP_REQUIRED') {
        toast.info(t('toast.verifyFirst'), message)
        setDnsState({ server, dns: null })
      } else if (httpStatus === 429 || code === 'PROBE_TOO_FREQUENT') {
        toast.info(
          retryAfterSec ? t('toast.waitSeconds', { s: retryAfterSec }) : t('toast.waitGeneric'),
          message,
        )
      } else if (httpStatus === 404) {
        toast.error(t('toast.notFound'), message)
        void load(true)
      } else {
        toast.error(t('toast.measureFailed'), message)
      }
    }
  }

  /** After add/edit: refresh the list; if DNS instructions came back, open them right away */
  const handleSaved = (server: Server, dns?: DnsInstructions) => {
    // Edits return the server with probe fields already reset by the backend
    setServers((prev) => (prev.some((s) => s.id === server.id) ? prev.map((s) => (s.id === server.id ? server : s)) : prev))
    stopProbing(server.id)
    void load(true)
    if (dns) setDnsState({ server, dns })
  }

  /** verify result updates the card without a full reload */
  const handleVerified = (result: DnsVerificationResult['server']) => {
    const before = serversRef.current.find((s) => s.id === result.id)

    setServers((prev) =>
      prev.map((s) =>
        s.id === result.id
          ? { ...s, status: result.status, dnsVerified: result.dnsVerified, gatewayReachable: result.gatewayReachable }
          : s,
      ),
    )
    setDnsState((prev) =>
      prev && prev.server.id === result.id ? { ...prev, server: { ...prev.server, ...result } } : prev,
    )

    // First successful ownership proof → the backend starts a full probe by itself
    if (before && !before.dnsVerified && result.dnsVerified) {
      startProbing(result.id, before.lastProbeAt)
      toast.info(t('toast.autoMeasure'), t('toast.autoMeasureDesc'))
    }

    void load(true)
  }

  const handleDeleted = (id: string) => {
    setServers((prev) => prev.filter((s) => s.id !== id))
    setDetail((prev) => (prev?.id === id ? null : prev))
    stopProbing(id)
    void load(true)
  }

  const openDnsFromDrawer = (server: Server) => {
    setDetail(null)
    setDnsState({ server, dns: null })
  }

  // ---------------- Fleet health (from the backend summary) ----------------
  const total = summary ? STATUS_ORDER.reduce((n, s) => n + (summary[s] ?? 0), 0) : 0
  const attention = summary ? (summary.DEGRADED ?? 0) + (summary.OFFLINE ?? 0) : 0

  const chips: { value: string; label: string; count: number | null; dot: string }[] = [
    { value: '', label: t('page.fleet.all'), count: summary ? total : null, dot: 'bg-cyan-400' },
    ...STATUS_ORDER.map((s) => ({
      value: s,
      label: t(`status.${s}` as never) || STATUS_META[s].label,
      count: summary ? (summary[s] ?? 0) : null,
      dot: STATUS_BAR[s],
    })),
  ]

  // Capacity numbers for the servers on the current page
  const measuredOnPage = servers.filter((s) => s.safeRequestsPerSecond !== null)
  const pageCapacity = measuredOnPage.reduce((n, s) => n + (s.safeRequestsPerSecond ?? 0), 0)
  const unverifiedOnPage = servers.filter((s) => !s.dnsVerified).length

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={ServerIcon}
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            <Button icon={RefreshCw} loading={loading && servers.length > 0} onClick={() => void load()}>
              {t('page.refresh')}
            </Button>
            {canManage && (
              <Button variant="primary" icon={Plus} onClick={() => setFormState({ open: true, server: null })}>
                {t('page.add')}
              </Button>
            )}
          </>
        }
      />

      {/* ---------- Attention: servers that need a look ---------- */}
      {summary && attention > 0 && status === '' && (
        <div className="zp-anim-fade-up flex flex-col gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/6 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <p className="text-sm text-rose-100">
              <Trans
                ns="servers"
                i18nKey="page.attention"
                count={attention}
                values={{ offline: summary.OFFLINE ?? 0, degraded: summary.DEGRADED ?? 0 }}
                components={{ b: <span className="font-semibold" /> }}
              />
            </p>
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setStatus((summary.OFFLINE ?? 0) > 0 ? 'OFFLINE' : 'DEGRADED')
              setPage(1)
            }}
          >
            {t('page.showThem')}
          </Button>
        </div>
      )}

      {/* ---------- Fleet health ---------- */}
      <Card accent className="p-5" delay={60}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.fleet.title')}</p>
            {!summary ? (
              <Skeleton className="mt-2 h-8 w-40 rounded-md" />
            ) : (
              <p className="mt-1 text-2xl font-bold tracking-tight text-white">
                {summary.ONLINE ?? 0}
                <span className="text-base font-medium text-slate-500"> {t('page.fleet.onlineSuffix', { total })}</span>
              </p>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {t('page.fleet.clickHint')}
            {lastSyncedAt ? ` · ${t('page.fleet.updated', { time: timeAgo(lastSyncedAt) })}` : ''}
          </p>
        </div>

        {/* Segmented bar */}
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-white/6">
          {summary &&
            total > 0 &&
            STATUS_ORDER.map((s) => {
              const n = summary[s] ?? 0
              return n > 0 ? (
                <div
                  key={s}
                  title={`${t(`status.${s}` as never)}: ${n}`}
                  className={cn('zp-anim-bar h-full', STATUS_BAR[s])}
                  style={{ width: `${(n / total) * 100}%` }}
                />
              ) : null
            })}
        </div>

        {/* Status filter chips */}
        <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {chips.map((c) => {
            const active = status === c.value
            return (
              <button
                key={c.value || 'all'}
                type="button"
                onClick={() => {
                  setStatus(c.value)
                  setPage(1)
                }}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                  active
                    ? 'border-cyan-400/40 bg-cyan-500/15 text-white'
                    : 'border-white/10 bg-white/3 text-slate-400 hover:border-white/20 hover:text-white',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', c.dot)} />
                {c.label}
                <span className={cn('rounded-md px-1.5 text-xs', active ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-500')}>
                  {c.count ?? '–'}
                </span>
              </button>
            )
          })}
        </div>

        {/* Capacity snapshot for the servers on this page */}
        {servers.length > 0 && (
          <div className="mt-4 grid gap-3 border-t border-white/6 pt-4 sm:grid-cols-3">
            <div className="rounded-xl bg-black/20 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Gauge className="h-3.5 w-3.5 text-cyan-400" /> {t('page.fleet.capacity')}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums text-white">
                {measuredOnPage.length > 0 ? fmtInt(pageCapacity) : '—'}
                <span className="ml-1 text-xs font-medium text-slate-500">req/s</span>
              </p>
            </div>
            <div className="rounded-xl bg-black/20 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('page.fleet.measured')}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-white">
                {measuredOnPage.length}
                <span className="text-sm font-medium text-slate-500"> / {servers.length}</span>
              </p>
            </div>
            <div className="rounded-xl bg-black/20 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-amber-300" /> {t('page.fleet.awaiting')}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums text-white">{unverifiedOnPage}</p>
            </div>
          </div>
        )}
      </Card>

      {/* ---------- Filters ---------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1">
          <TextInput
            icon={Search}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder={t('page.filters.search')}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:flex">
          <SelectInput
            value={mode}
            onChange={(e) => {
              setMode(e.target.value)
              setPage(1)
            }}
            className="lg:w-40"
          >
            <option value="">{t('page.filters.allModes')}</option>
            <option value="PROTECT" className="bg-[#0b1224]">{t('mode.PROTECT')}</option>
            <option value="MONITOR_ONLY" className="bg-[#0b1224]">{t('mode.MONITOR_ONLY')}</option>
          </SelectInput>
          <SelectInput
            value={dnsFilter}
            onChange={(e) => {
              setDnsFilter(e.target.value)
              setPage(1)
            }}
            className="lg:w-44"
          >
            <option value="">{t('page.filters.anyDns')}</option>
            <option value="true" className="bg-[#0b1224]">{t('page.filters.verified')}</option>
            <option value="false" className="bg-[#0b1224]">{t('page.filters.notVerified')}</option>
          </SelectInput>
          <SelectInput
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey)
              setPage(1)
            }}
            className="col-span-2 lg:col-span-1 lg:w-44"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#0b1224]">
                {t(o.labelKey as never)}
              </option>
            ))}
          </SelectInput>
        </div>
        {hasFilters && (
          <Button icon={X} variant="ghost" onClick={clearFilters}>
            {t('page.filters.clear')}
          </Button>
        )}
      </div>

      {/* ---------- Grid ---------- */}
      {error && servers.length === 0 ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : loading && servers.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-full rounded-2xl" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <Card>
          <EmptyState
            icon={ServerIcon}
            title={hasFilters ? t('page.empty.filteredTitle') : t('page.empty.noneTitle')}
            description={
              hasFilters
                ? t('page.empty.filteredDesc')
                : canManage
                  ? t('page.empty.noneManage')
                  : t('page.empty.noneViewer')
            }
            action={
              hasFilters ? (
                <Button icon={X} onClick={clearFilters}>{t('page.filters.clearFilters')}</Button>
              ) : canManage ? (
                <Button variant="primary" icon={Plus} onClick={() => setFormState({ open: true, server: null })}>
                  {t('page.add')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', loading && 'opacity-70')}>
            {servers.map((server, i) => (
              <ServerCard
                key={server.id}
                server={server}
                index={i}
                canManage={canManage}
                busy={busyId === server.id}
                probing={probingIds.has(server.id)}
                onDns={() => setDnsState({ server, dns: null })}
                onEdit={() => setFormState({ open: true, server })}
                onDelete={() => setDeleting(server)}
                onMaintenance={() => void handleMaintenance(server)}
                onProbe={() => void handleProbe(server)}
                onDetails={() => setDetail(server)}
              />
            ))}
          </div>

          {pagination.totalPages > 1 && (
            <Card>
              <PaginationBar
                page={page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                limit={PAGE_SIZE}
                disabled={loading}
                onPage={setPage}
              />
            </Card>
          )}
        </>
      )}

      {/* ---------- Modals / Drawer ---------- */}
      <ServerFormModal
        open={formState.open}
        server={formState.server}
        onClose={() => setFormState((s) => ({ ...s, open: false }))}
        onSaved={handleSaved}
      />
      <DnsModal
        server={dnsServer}
        initialDns={dnsState?.dns ?? null}
        canManage={canManage}
        onClose={() => setDnsState(null)}
        onVerified={handleVerified}
      />
      <DeleteModal server={deleting} onClose={() => setDeleting(null)} onDeleted={handleDeleted} />
      <ServerDetailDrawer
        server={detailServer}
        canManage={canManage}
        onClose={() => setDetail(null)}
        onOpenDns={openDnsFromDrawer}
        onServerUpdated={replaceServer}
      />

      {/* Small hint when nothing is online yet but some servers are still pending */}
      {summary && summary.ONLINE === 0 && (summary.PENDING ?? 0) > 0 && (
        <p className="flex items-center justify-center gap-2 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5" />
          {t('page.hint')}
        </p>
      )}
    </PageShell>
  )
}
