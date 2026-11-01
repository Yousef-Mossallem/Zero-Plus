// frontend/src/pages/ServersPage.tsx
// ==================================================================
// Zero Plus - Servers Page
// إدارة السيرفرات المحمية (مربوطة بـ backend/modules/servers)
//
//   GET    /servers                 → قائمة + pagination + summary (عدد كل حالة)
//   POST   /servers                 → إضافة سيرفر (بيرجع تعليمات الـ DNS)
//   PATCH  /servers/:id             → تعديل (تغيير الدومين بيصفّر التحقق)
//   GET    /servers/:id/dns         → تعليمات الـ DNS + حالة التحقق
//   POST   /servers/:id/verify      → تحقق (ownership | routing | all)
//   POST   /servers/:id/maintenance → تشغيل/إيقاف وضع الصيانة
//   DELETE /servers/:id?confirmDomain= → حذف (لازم تكتب الدومين للتأكيد)
//
// الصلاحيات: الإضافة/التعديل/الحذف/التحقق = OWNER أو ADMIN بس (زي الباك).
// باقي الأدوار بتشاهد وتشوف تعليمات الـ DNS.
//
// التصميم: كارت Fleet health (شريط الحالات + أزرار فلترة) → تنبيه الانتباه
//          → صف فلاتر خفيف → كروت السيرفرات
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Plus, RefreshCw, Search, Server as ServerIcon, X } from 'lucide-react'
import { useToast } from '../components/ui/Toast'
import { Button, Card, EmptyState, ErrorState, PageHeader, PageShell, PaginationBar, SelectInput, Skeleton, TextInput } from '../components/ui/kit'
import { useDebounce } from '../hooks/useDebounce'
import { parseApiError } from '../services/apiError'
import { listServers, setMaintenance, type DnsInstructions, type DnsVerificationResult, type Server, type ServersQuery } from '../services/serversService'
import type { ServerMode, ServerStatus } from '../services/types'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { cn } from '../utils/format'
import { MANAGE_ROLES, PAGE_SIZE, STATUS_META } from './servers/shared'
import { ServerFormModal } from './servers/ServerFormModal'
import { DnsModal } from './servers/DnsModal'
import { DeleteModal } from './servers/DeleteModal'
import { ServerCard } from './servers/ServerCard'

// ترتيب وألوان الحالات في شريط الـ Fleet health
const STATUS_ORDER: ServerStatus[] = ['ONLINE', 'DEGRADED', 'OFFLINE', 'PENDING', 'MAINTENANCE']

const STATUS_BAR: Record<ServerStatus, string> = {
  ONLINE: 'bg-emerald-400',
  DEGRADED: 'bg-amber-400',
  OFFLINE: 'bg-rose-500',
  PENDING: 'bg-slate-500',
  MAINTENANCE: 'bg-indigo-400',
}

// ==================================================================
// Page
// ==================================================================

export default function ServersPage() {
  const toast = useToast()
  const role = useAuthStore(selectUserRole)
  const canManage = role !== null && MANAGE_ROLES.includes(role)

  // ---------------- Filters ----------------
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('')
  const [dnsFilter, setDnsFilter] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search)

  // ---------------- Data ----------------
  const [servers, setServers] = useState<Server[]>([])
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 })
  const [summary, setSummary] = useState<Record<ServerStatus, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const requestId = useRef(0)

  // ---------------- Modals ----------------
  const [formState, setFormState] = useState<{ open: boolean; server: Server | null }>({ open: false, server: null })
  const [dnsState, setDnsState] = useState<{ server: Server; dns: DnsInstructions | null } | null>(null)
  const [deleting, setDeleting] = useState<Server | null>(null)

  // ---------------- Load ----------------
  const query = useMemo<ServersQuery>(
    () => ({
      page,
      limit: PAGE_SIZE,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
      ...(status && { status: status as ServerStatus }),
      ...(mode && { mode: mode as ServerMode }),
      ...(dnsFilter && { dnsVerified: dnsFilter === 'true' }),
    }),
    [page, debouncedSearch, status, mode, dnsFilter],
  )

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await listServers(query)
      if (id !== requestId.current) return
      setServers(res.data)
      setPagination({ total: res.pagination.total, totalPages: res.pagination.totalPages })
      setSummary(res.summary)
      setError(null)
    } catch (err) {
      if (id !== requestId.current) return
      const { message } = parseApiError(err)
      setError(message)
      toast.error('Failed to load servers', message)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [query, toast])

  useEffect(() => {
    void load()
  }, [load])

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

  const handleMaintenance = async (server: Server) => {
    const enable = server.status !== 'MAINTENANCE'
    setBusyId(server.id)
    try {
      const res = await setMaintenance(server.id, enable)
      replaceServer(res.data)
      toast.success(res.message)
      void load() // الـ summary بيتغير
    } catch (err) {
      toast.error('Could not change maintenance mode', parseApiError(err).message)
    } finally {
      setBusyId(null)
    }
  }

  /** بعد إضافة/تعديل: نحدّث القائمة، ولو فيه تعليمات DNS نفتحها فورًا */
  const handleSaved = (server: Server, dns?: DnsInstructions) => {
    void load()
    if (dns) setDnsState({ server, dns })
  }

  /** نتيجة verify بتحدّث كارت السيرفر من غير إعادة تحميل */
  const handleVerified = (result: DnsVerificationResult['server']) => {
    setServers((prev) =>
      prev.map((s) =>
        s.id === result.id
          ? { ...s, status: result.status, dnsVerified: result.dnsVerified, gatewayReachable: result.gatewayReachable }
          : s,
      ),
    )
    setDnsState((prev) =>
      prev && prev.server.id === result.id
        ? { ...prev, server: { ...prev.server, ...result } }
        : prev,
    )
    void load()
  }

  const handleDeleted = (id: string) => {
    setServers((prev) => prev.filter((s) => s.id !== id))
    void load()
  }

  // ---------------- Fleet health (من summary الباك) ----------------
  const total = summary ? STATUS_ORDER.reduce((n, s) => n + (summary[s] ?? 0), 0) : 0
  const attention = summary ? (summary.DEGRADED ?? 0) + (summary.OFFLINE ?? 0) : 0

  const chips: { value: string; label: string; count: number | null; dot: string }[] = [
    { value: '', label: 'All', count: summary ? total : null, dot: 'bg-cyan-400' },
    ...STATUS_ORDER.map((s) => ({
      value: s,
      label: STATUS_META[s].label,
      count: summary ? (summary[s] ?? 0) : null,
      dot: STATUS_BAR[s],
    })),
  ]

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={ServerIcon}
        title="Protected Servers"
        subtitle="Domains protected by the Gateway, their DNS setup and health."
        actions={
          <>
            <Button icon={RefreshCw} loading={loading && servers.length > 0} onClick={() => void load()}>
              Refresh
            </Button>
            {canManage && (
              <Button variant="primary" icon={Plus} onClick={() => setFormState({ open: true, server: null })}>
                Add server
              </Button>
            )}
          </>
        }
      />

      {/* ---------- تنبيه: سيرفرات محتاجة انتباه ---------- */}
      {summary && attention > 0 && status === '' && (
        <div className="zp-anim-fade-up flex flex-col gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/6 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <p className="text-sm text-rose-100">
              <span className="font-semibold">
                {attention} server{attention === 1 ? '' : 's'}
              </span>{' '}
              need attention ({summary.OFFLINE ?? 0} offline · {summary.DEGRADED ?? 0} degraded).
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
            Show them
          </Button>
        </div>
      )}

      {/* ---------- Fleet health ---------- */}
      <Card accent className="p-5" delay={60}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Fleet health</p>
            {!summary ? (
              <Skeleton className="mt-2 h-8 w-40 rounded-md" />
            ) : (
              <p className="mt-1 text-2xl font-bold tracking-tight text-white">
                {summary.ONLINE ?? 0}
                <span className="text-base font-medium text-slate-500"> / {total} online</span>
              </p>
            )}
          </div>
          <p className="text-xs text-slate-500">Click a status to filter</p>
        </div>

        {/* الشريط المتقسّم */}
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-white/6">
          {summary &&
            total > 0 &&
            STATUS_ORDER.map((s) => {
              const n = summary[s] ?? 0
              return n > 0 ? (
                <div
                  key={s}
                  title={`${STATUS_META[s].label}: ${n}`}
                  className={cn('zp-anim-bar h-full', STATUS_BAR[s])}
                  style={{ width: `${(n / total) * 100}%` }}
                />
              ) : null
            })}
        </div>

        {/* أزرار الفلترة بالحالة */}
        <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {chips.map((c) => {
            const active = status === c.value
            return (
              <button
                key={c.label}
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
      </Card>

      {/* ---------- Filters (صف خفيف) ---------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1">
          <TextInput
            icon={Search}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search by domain or origin IP…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:flex">
          <SelectInput
            value={mode}
            onChange={(e) => {
              setMode(e.target.value)
              setPage(1)
            }}
            className="lg:w-44"
          >
            <option value="">All modes</option>
            <option value="PROTECT" className="bg-[#0b1224]">Protect</option>
            <option value="MONITOR_ONLY" className="bg-[#0b1224]">Monitor only</option>
          </SelectInput>
          <SelectInput
            value={dnsFilter}
            onChange={(e) => {
              setDnsFilter(e.target.value)
              setPage(1)
            }}
            className="lg:w-48"
          >
            <option value="">Any DNS state</option>
            <option value="true" className="bg-[#0b1224]">Ownership verified</option>
            <option value="false" className="bg-[#0b1224]">Not verified</option>
          </SelectInput>
        </div>
        {hasFilters && (
          <Button icon={X} variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      {/* ---------- Grid ---------- */}
      {error && servers.length === 0 ? (
        <Card><ErrorState message={error} onRetry={() => void load()} /></Card>
      ) : loading && servers.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-2xl" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <Card>
          <EmptyState
            icon={ServerIcon}
            title={hasFilters ? 'No servers match these filters' : 'No protected servers yet'}
            description={
              hasFilters
                ? 'Try widening the filters.'
                : canManage
                  ? 'Add your first domain to start routing its traffic through the Gateway.'
                  : 'An Owner or Admin needs to add the first server.'
            }
            action={
              hasFilters ? (
                <Button icon={X} onClick={clearFilters}>Clear filters</Button>
              ) : canManage ? (
                <Button variant="primary" icon={Plus} onClick={() => setFormState({ open: true, server: null })}>
                  Add server
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
                onDns={() => setDnsState({ server, dns: null })}
                onEdit={() => setFormState({ open: true, server })}
                onDelete={() => setDeleting(server)}
                onMaintenance={() => void handleMaintenance(server)}
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

      {/* ---------- Modals ---------- */}
      <ServerFormModal
        open={formState.open}
        server={formState.server}
        onClose={() => setFormState((s) => ({ ...s, open: false }))}
        onSaved={handleSaved}
      />
      <DnsModal
        server={dnsState?.server ?? null}
        initialDns={dnsState?.dns ?? null}
        canManage={canManage}
        onClose={() => setDnsState(null)}
        onVerified={handleVerified}
      />
      <DeleteModal server={deleting} onClose={() => setDeleting(null)} onDeleted={handleDeleted} />

      {/* ملاحظة صغيرة تظهر لو مفيش أي سيرفر Online ولسه فيه Pending */}
      {summary && summary.ONLINE === 0 && summary.PENDING > 0 && (
        <p className="flex items-center justify-center gap-2 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5" />
          Protection starts once DNS ownership and routing are verified.
        </p>
      )}
    </PageShell>
  )
}