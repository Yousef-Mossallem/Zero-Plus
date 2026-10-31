// frontend/src/pages/ReportsPage.tsx
// ==================================================================
// Zero Plus - Reports Page (التقارير + شات المساعد)
// مربوطة بـ backend/modules/reports:
//   GET /reports (فلاتر + pagination + summary) • POST /reports • GET /reports/:id
//   DELETE /reports/:id (OWNER/ADMIN) • POST /reports/chat
// الحالات: PENDING → GENERATING → READY | FAILED
// اللحظي: حدث السوكيت report:status (created / status_changed / deleted)
//   بيحدّث الصف في الجدول (والـ Drawer المفتوح) من غير Refresh
// الفورم/الـ Drawer/الشات/Markdown في فولدر reports/
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, CheckCircle2, Clock, FilePlus2, FileText, RefreshCw, XCircle, X } from 'lucide-react'

import { useToast } from '../components/ui/Toast'
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  PaginationBar,
  SelectInput,
  Skeleton,
  StatCard,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import {
  listReports,
  type Report,
  type ReportSocketPayload,
  type ReportStatus,
  type ReportType,
  type ReportsQuery,
} from '../services/reportsService'
import { listServers, type Server } from '../services/serversService'
import { SocketEvents, getSocket } from '../services/socket'
import { selectUserRole, useAuthStore } from '../store/authStore'
import { cn, formatNumber, timeAgo } from '../utils/format'
import ChatPanel from './reports/ChatPanel'
import CreateReportModal from './reports/CreateReportModal'
import ReportDrawer from './reports/ReportDrawer'
import { MANAGE_ROLES, ReportStatusBadge, STATUS_META, TYPE_META, periodLabel } from './reports/shared'

type Summary = Partial<Record<ReportStatus, number>>

/** حماية: payload السوكيت جاي من الشبكة */
function isReportPayload(v: unknown): v is ReportSocketPayload {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.status === 'string' && typeof o.action === 'string'
}

export default function ReportsPage() {
  const toast = useToast()
  const role = useAuthStore(selectUserRole)
  const canDelete = role !== null && MANAGE_ROLES.includes(role)

  // ---------------- filters / paging ----------------
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [serverId, setServerId] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)

  // ---------------- data ----------------
  const [reports, setReports] = useState<Report[]>([])
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 })
  const [summary, setSummary] = useState<Summary>({})
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---------------- UI ----------------
  const [creating, setCreating] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const reqId = useRef(0)

  const query = useMemo<ReportsQuery>(
    () => ({
      page,
      limit,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...(status && { status: status as ReportStatus }),
      ...(type && { type: type as ReportType }),
      ...(serverId && { serverId }),
    }),
    [page, limit, status, type, serverId],
  )

  /** silent=true للتحديثات اللحظية: من غير skeleton ولا توست */
  const load = useCallback(
    async (silent = false) => {
      const id = ++reqId.current
      if (!silent) setLoading(true)
      try {
        const res = await listReports(query)
        if (id !== reqId.current) return
        setReports(res.data)
        setPagination({ total: res.pagination.total, totalPages: res.pagination.totalPages })
        setSummary(res.summary)
        setError(null)
      } catch (err) {
        if (id !== reqId.current) return
        const { message } = parseApiError(err)
        if (!silent) {
          setError(message)
          toast.error('Failed to load reports', message)
        }
      } finally {
        if (id === reqId.current && !silent) setLoading(false)
      }
    },
    [query, toast],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    listServers({ limit: 100, sortBy: 'domain', sortOrder: 'asc' })
      .then((res) => setServers(res.data))
      .catch(() => {})
  }, [])

  // ---------------- Socket: report:status ----------------
  // نحتفظ بآخر load في ref عشان المستمع مايتسجلش من جديد مع كل تغيير فلتر
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const socket = getSocket()
    const onStatus = (payload: unknown) => {
      if (!isReportPayload(payload)) return

      if (payload.action === 'deleted') {
        setReports((prev) => prev.filter((r) => r.id !== payload.id))
        setSelectedId((cur) => {
          if (cur === payload.id) toast.info('This report was deleted')
          return cur === payload.id ? null : cur
        })
        void loadRef.current(true) // الأعداد والصفحات
        return
      }

      if (payload.action === 'status_changed') {
        // تحديث فوري للصف (الحالة + رسالة الخطأ) قبل ما نجيب الملخص من الباك
        setReports((prev) =>
          prev.map((r) =>
            r.id === payload.id
              ? { ...r, status: payload.status, errorMessage: payload.errorMessage, updatedAt: payload.updatedAt }
              : r,
          ),
        )
      }
      // created / READY / FAILED: نجيب القايمة والأعداد والملخص من الباك
      void loadRef.current(true)
    }

    socket.on(SocketEvents.REPORT_STATUS, onStatus)
    return () => {
      socket.off(SocketEvents.REPORT_STATUS, onStatus)
    }
  }, [toast])

  // ---------------- helpers ----------------
  const hasFilters = Boolean(status || type || serverId)
  const clearFilters = () => {
    setStatus('')
    setType('')
    setServerId('')
    setPage(1)
  }
  const selected = reports.find((r) => r.id === selectedId) ?? null
  const inProgress = (summary.GENERATING ?? 0) + (summary.PENDING ?? 0)
  const total = Object.values(summary).reduce((n, v) => n + (v ?? 0), 0)

  return (
    <PageShell>
      <PageHeader
        icon={FileText}
        title="Reports"
        subtitle="AI-written security reports for your traffic, plus an assistant you can ask directly."
        actions={
          <>
            <Button icon={Bot} onClick={() => setChatOpen(true)}>Ask assistant</Button>
            <Button icon={RefreshCw} loading={loading && reports.length > 0} onClick={() => void load()}>Refresh</Button>
            <Button variant="primary" icon={FilePlus2} onClick={() => setCreating(true)}>New report</Button>
          </>
        }
      />

      {/* ---------- Stats (من summary الباك) ---------- */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="All reports" value={formatNumber(total)} icon={FileText} tone="cyan" loading={loading && reports.length === 0} delay={0} />
        <StatCard label="Ready" value={formatNumber(summary.READY ?? 0)} icon={CheckCircle2} tone="emerald" loading={loading && reports.length === 0} delay={60} />
        <StatCard label="In progress" value={formatNumber(inProgress)} icon={Clock} tone="amber" loading={loading && reports.length === 0} delay={120}
          hint={inProgress > 0 ? 'Updating live' : undefined} />
        <StatCard label="Failed" value={formatNumber(summary.FAILED ?? 0)} icon={XCircle} tone="rose" loading={loading && reports.length === 0} delay={180} />
      </div>

      {/* ---------- Filters ---------- */}
      <Card className="p-5" delay={120} accent>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
            <SelectInput value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_META) as ReportStatus[]).map((s) => (
                <option key={s} value={s} className="bg-[#0b1224]">{STATUS_META[s].label}</option>
              ))}
            </SelectInput>
            <SelectInput value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}>
              <option value="">All types</option>
              {(Object.keys(TYPE_META) as ReportType[]).map((t) => (
                <option key={t} value={t} className="bg-[#0b1224]">{TYPE_META[t].label}</option>
              ))}
            </SelectInput>
            <SelectInput value={serverId} onChange={(e) => { setServerId(e.target.value); setPage(1) }}>
              <option value="">All servers</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#0b1224]">{s.domain}</option>
              ))}
            </SelectInput>
          </div>
          {hasFilters && <Button icon={X} variant="ghost" onClick={clearFilters}>Clear</Button>}
        </div>
      </Card>

      {/* ---------- List ---------- */}
      <Card delay={200}>
        {error && reports.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : loading && reports.length === 0 ? (
          <div className="space-y-px p-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="my-2 h-16 w-full rounded-xl" />)}
          </div>
        ) : reports.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={hasFilters ? 'No reports match these filters' : 'No reports yet'}
            description={hasFilters ? 'Try widening the filters.' : 'Generate your first AI security report for any period up to 31 days.'}
            action={hasFilters
              ? <Button icon={X} onClick={clearFilters}>Clear filters</Button>
              : <Button variant="primary" icon={FilePlus2} onClick={() => setCreating(true)}>New report</Button>}
          />
        ) : (
          <>
            <ul className={cn(loading && 'opacity-60')}>
              {reports.map((r, i) => (
                <li
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                  className="zp-anim-fade-up group flex cursor-pointer items-center gap-4 border-b border-white/5 px-5 py-4 last:border-0 hover:bg-white/3"
                >
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    r.status === 'READY' ? 'bg-emerald-500/10 text-emerald-400'
                      : r.status === 'FAILED' ? 'bg-rose-500/10 text-rose-400'
                      : r.status === 'GENERATING' ? 'bg-amber-400/10 text-amber-300' : 'bg-white/5 text-slate-400')}>
                    <FileText className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-sm font-semibold text-white">{r.title}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{periodLabel(r)}</p>
                    {r.status === 'FAILED' && r.errorMessage && (
                      <p dir="auto" className="mt-1 truncate text-xs text-rose-300/80">{r.errorMessage}</p>
                    )}
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    <Badge tone={TYPE_META[r.type].tone}>{TYPE_META[r.type].label}</Badge>
                  </div>
                  <div className="hidden text-right text-xs text-slate-500 md:block">
                    <p>{formatNumber(r.eventCount)} events</p>
                    <p>{formatNumber(r.blockedCount)} blocked</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <ReportStatusBadge status={r.status} />
                    <span className="text-[11px] text-slate-600">{timeAgo(r.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <PaginationBar
              page={page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={limit}
              disabled={loading}
              onPage={setPage}
              onLimit={(n) => { setLimit(n); setPage(1) }}
            />
          </>
        )}
      </Card>

      {/* ---------- Modals / Drawers ---------- */}
      <CreateReportModal
        open={creating}
        servers={servers}
        onClose={() => setCreating(false)}
        onCreated={() => { setPage(1); void load(true) }}
      />

      <ReportDrawer
        report={selected}
        canDelete={canDelete}
        onClose={() => setSelectedId(null)}
        onDeleted={(id) => { setReports((prev) => prev.filter((r) => r.id !== id)); void load(true) }}
      />

      <Drawer open={chatOpen} onClose={() => setChatOpen(false)} title="Security assistant" subtitle="Powered by Gemini · your data stays in your organization">
        <ChatPanel servers={servers} />
      </Drawer>
    </PageShell>
  )
}
