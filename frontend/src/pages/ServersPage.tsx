// frontend/src/pages/ServersPage.tsx
// ==================================================================
// Zero Plus - Servers Page
// إدارة السيرفرات المحمية (مربوطة بـ backend/modules/servers)
//
//   GET    /servers                 → قائمة + pagination + summary
//   POST   /servers                 → إضافة سيرفر (بيرجع تعليمات الـ DNS)
//   PATCH  /servers/:id             → تعديل (تغيير الدومين بيصفّر التحقق)
//   GET    /servers/:id/dns         → تعليمات الـ DNS + حالة التحقق
//   POST   /servers/:id/verify      → تحقق (ownership | routing | all)
//   POST   /servers/:id/maintenance → تشغيل/إيقاف وضع الصيانة
//   DELETE /servers/:id?confirmDomain= → حذف (لازم تكتب الدومين للتأكيد)
//
// الصلاحيات: الإضافة/التعديل/الحذف/التحقق = OWNER أو ADMIN بس
// باقي الأدوار بتشاهد وتشوف تعليمات الـ DNS
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
  Wrench,
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
  StatCard,
  TextInput,
} from '../components/ui/kit'
import { useDebounce } from '../hooks/useDebounce'
import { parseApiError } from '../services/apiError'
import {
  listServers,
  setMaintenance,
  type DnsInstructions,
  type DnsVerificationResult,
  type Server,
  type ServersQuery,
} from '../services/serversService'
import type { ServerMode, ServerStatus } from '../services/types'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { cn } from '../utils/format'

import { MANAGE_ROLES, PAGE_SIZE, STATUS_META } from './servers/shared'
import { ServerFormModal } from './servers/ServerFormModal'
import { DnsModal } from './servers/DnsModal'
import { DeleteModal } from './servers/DeleteModal'
import { ServerCard } from './servers/ServerCard'

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
  const [formState, setFormState] = useState<{ open: boolean; server: Server | null }>({
    open: false,
    server: null,
  })
  const [dnsState, setDnsState] = useState<{
    server: Server
    dns: DnsInstructions | null
  } | null>(null)
  const [deleting, setDeleting] = useState<Server | null>(null)

  // ---------------- Query ----------------
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

  // ---------------- Load ----------------
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)

    try {
      const res = await listServers(query)
      if (id !== requestId.current) return

      setServers(res.data)
      setPagination({
        total: res.pagination.total,
        totalPages: res.pagination.totalPages,
      })
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
      void load()
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

  /** نتيجة verify بتحدّث كارت السيرفر من غير إعادة تحميل كاملة */
  const handleVerified = (result: DnsVerificationResult['server']) => {
    setServers((prev) =>
      prev.map((s) =>
        s.id === result.id
          ? {
              ...s,
              status: result.status,
              dnsVerified: result.dnsVerified,
              gatewayReachable: result.gatewayReachable,
            }
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

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      {/* ---------- Header ---------- */}
      <PageHeader
        icon={ServerIcon}
        title="Protected Servers"
        subtitle="Domains protected by the Gateway — manage DNS setup, health and maintenance."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={RefreshCw}
              loading={loading && servers.length > 0}
              onClick={() => void load()}
            >
              Refresh
            </Button>

            {canManage && (
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => setFormState({ open: true, server: null })}
              >
                Add server
              </Button>
            )}
          </div>
        }
      />

      {/* ---------- Stats ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Online"
          value={summary?.ONLINE ?? 0}
          icon={CheckCircle2}
          tone="emerald"
          loading={!summary}
          delay={0}
        />
        <StatCard
          label="Degraded / Offline"
          value={summary ? summary.DEGRADED + summary.OFFLINE : 0}
          icon={AlertTriangle}
          tone="rose"
          loading={!summary}
          delay={60}
        />
        <StatCard
          label="Pending setup"
          value={summary?.PENDING ?? 0}
          icon={Circle}
          tone="amber"
          loading={!summary}
          delay={120}
        />
        <StatCard
          label="Maintenance"
          value={summary?.MAINTENANCE ?? 0}
          icon={Wrench}
          tone="indigo"
          loading={!summary}
          delay={180}
        />
      </div>

      {/* ---------- Filters ---------- */}
      <Card className="p-5" delay={150} accent>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex lg:shrink-0">
            <SelectInput
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(1)
              }}
              className="lg:w-44"
            >
              <option value="">All statuses</option>
              {(Object.keys(STATUS_META) as ServerStatus[]).map((s) => (
                <option key={s} value={s} className="bg-[#0b1224]">
                  {STATUS_META[s].label}
                </option>
              ))}
            </SelectInput>

            <SelectInput
              value={mode}
              onChange={(e) => {
                setMode(e.target.value)
                setPage(1)
              }}
              className="lg:w-44"
            >
              <option value="">All modes</option>
              <option value="PROTECT" className="bg-[#0b1224]">
                Protect
              </option>
              <option value="MONITOR_ONLY" className="bg-[#0b1224]">
                Monitor only
              </option>
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
              <option value="true" className="bg-[#0b1224]">
                Ownership verified
              </option>
              <option value="false" className="bg-[#0b1224]">
                Not verified
              </option>
            </SelectInput>
          </div>

          {hasFilters && (
            <Button icon={X} variant="ghost" onClick={clearFilters} className="shrink-0">
              Clear
            </Button>
          )}
        </div>
      </Card>

      {/* ---------- Content ---------- */}
      {error && servers.length === 0 ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : loading && servers.length === 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-80 w-full rounded-2xl" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <Card>
          <EmptyState
            icon={ServerIcon}
            title={hasFilters ? 'No servers match these filters' : 'No protected servers yet'}
            description={
              hasFilters
                ? 'Try widening the filters or clear them to see all servers.'
                : canManage
                  ? 'Add your first domain to start routing its traffic through the Gateway.'
                  : 'An Owner or Admin needs to add the first server.'
            }
            action={
              hasFilters ? (
                <Button icon={X} onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : canManage ? (
                <Button
                  variant="primary"
                  icon={Plus}
                  onClick={() => setFormState({ open: true, server: null })}
                >
                  Add server
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {/* Grid – مسافات أكبر عشان الكروت والأزرار تبان */}
          <div
            className={cn(
              'grid gap-5 sm:grid-cols-2 xl:grid-cols-3',
              loading && 'opacity-70 transition-opacity',
            )}
          >
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
            <Card className="mt-2">
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

      {/* ---------- Hint ---------- */}
      {summary && summary.ONLINE === 0 && summary.PENDING > 0 && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/15 bg-amber-500/5 px-4 py-3 text-xs text-amber-200/80">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>
            Protection starts once DNS ownership and routing are verified. Open any server card and
            click <strong className="text-amber-100">DNS Setup</strong> to continue.
          </span>
        </div>
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

      <DeleteModal
        server={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={handleDeleted}
      />
    </PageShell>
  )
}