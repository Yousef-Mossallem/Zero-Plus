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
import { Bot, FilePlus2, FileText, MessageSquareText, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useToast } from '../components/ui/Toast'
import {
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
import { cn, formatNumber } from '../utils/format'
import ChatPanel from './reports/ChatPanel'
import CreateReportModal from './reports/CreateReportModal'
import ReportDrawer from './reports/ReportDrawer'
import ReportCard from './reports/ReportCard'
import { MANAGE_ROLES, TYPE_META } from './reports/shared'

type Summary = Partial<Record<ReportStatus, number>>

/** حماية: payload السوكيت جاي من الشبكة */
function isReportPayload(v: unknown): v is ReportSocketPayload {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.status === 'string' && typeof o.action === 'string'
}

export default function ReportsPage() {
  const { t } = useTranslation(['reports', 'common'])
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
          toast.error(t('reports:toast.loadFailed', 'Failed to load reports'), message)
        }
      } finally {
        if (id === reqId.current && !silent) setLoading(false)
      }
    },
    [query, toast, t],
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
          if (cur === payload.id) toast.info(t('reports:toast.deleted', 'This report was deleted'))
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
  const total = Object.values(summary).reduce((n, v) => n + (v ?? 0), 0)

  const tabs: { value: string; label: string; count: number; dot: string }[] = [
    { value: '', label: t('reports:page.all', 'All'), count: total, dot: 'bg-cyan-400' },
    { value: 'READY', label: t('reports:status.READY', 'Ready'), count: summary.READY ?? 0, dot: 'bg-emerald-400' },
    { value: 'GENERATING', label: t('reports:status.GENERATING', 'Generating'), count: summary.GENERATING ?? 0, dot: 'bg-amber-400' },
    { value: 'PENDING', label: t('reports:status.PENDING', 'Pending'), count: summary.PENDING ?? 0, dot: 'bg-slate-400' },
    { value: 'FAILED', label: t('reports:status.FAILED', 'Failed'), count: summary.FAILED ?? 0, dot: 'bg-rose-400' },
  ]
  const firstLoad = loading && reports.length === 0

  return (
    <PageShell>
      <PageHeader
        icon={FileText}
        title={t('reports:page.title', 'Reports')}
        subtitle={t('reports:page.subtitle', 'AI-written security reports for your traffic.')}
        actions={
          <>
            <Button icon={RefreshCw} loading={loading && reports.length > 0} onClick={() => void load()}>{t('common:actions.refresh', 'Refresh')}</Button>
            <Button variant="primary" icon={FilePlus2} onClick={() => setCreating(true)}>{t('reports:page.newReport', 'New report')}</Button>
          </>
        }
      />

      {/* ---------- Assistant banner ---------- */}
      <Card accent className="bg-linear-to-r from-cyan-500/10 via-transparent to-indigo-500/10">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-400/20">
              <Bot className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{t('reports:page.assistantTitle', 'Security assistant')}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {t('reports:page.assistantDesc', 'Ask about attacks, blocked IPs or traffic patterns, and get answers from your own data.')}
              </p>
            </div>
          </div>
          <Button icon={MessageSquareText} onClick={() => setChatOpen(true)}>{t('reports:page.startChat', 'Start a chat')}</Button>
        </div>
      </Card>

      {/* ---------- Status tabs + secondary filters ---------- */}
      <div className="space-y-3">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {tabs.map((tItem) => {
            const active = status === tItem.value
            return (
              <button
                key={tItem.label}
                type="button"
                onClick={() => { setStatus(tItem.value); setPage(1) }}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition',
                  active
                    ? 'border-cyan-400/40 bg-cyan-500/15 text-white shadow-lg shadow-cyan-500/10'
                    : 'border-white/10 bg-white/3 text-slate-400 hover:border-white/20 hover:text-white',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', tItem.dot, tItem.value === 'GENERATING' && tItem.count > 0 && 'animate-pulse')} />
                {tItem.label}
                <span className={cn('rounded-md px-1.5 text-xs', active ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-500')}>
                  {firstLoad ? '–' : formatNumber(tItem.count)}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SelectInput className="sm:w-48" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}>
            <option value="">{t('reports:page.allTypes', 'All types')}</option>
            {(Object.keys(TYPE_META) as ReportType[]).map((tType) => (
              <option key={tType} value={tType} className="bg-[#0b1224]">{TYPE_META[tType].label}</option>
            ))}
          </SelectInput>
          <SelectInput className="sm:w-64" value={serverId} onChange={(e) => { setServerId(e.target.value); setPage(1) }}>
            <option value="">{t('reports:page.allServers', 'All servers')}</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0b1224]">{s.domain}</option>
            ))}
          </SelectInput>
          {hasFilters && <Button icon={X} variant="ghost" onClick={clearFilters}>{t('reports:page.clearFilters', 'Clear filters')}</Button>}
          {inProgressHint(summary) && (
            <span className="text-xs text-amber-300/80 sm:ml-auto">Reports in progress update live</span>
          )}
        </div>
      </div>

      {/* ---------- Cards grid ---------- */}
      {error && reports.length === 0 ? (
        <Card><ErrorState message={error} onRetry={() => void load()} /></Card>
      ) : firstLoad ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title={t('reports:page.empty.title', 'No reports found')}
            description={t('reports:page.empty.description', 'Create your first report to get an AI analysis of your traffic.')}
            action={hasFilters
              ? <Button icon={X} onClick={clearFilters}>{t('reports:page.clearFilters', 'Clear filters')}</Button>
              : <Button variant="primary" icon={FilePlus2} onClick={() => setCreating(true)}>{t('reports:page.newReport', 'New report')}</Button>}
          />
        </Card>
      ) : (
        <>
          <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', loading && 'opacity-60')}>
            {reports.map((r, i) => (
              <ReportCard key={r.id} report={r} index={i} onOpen={() => setSelectedId(r.id)} />
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
              onLimit={(n) => { setLimit(n); setPage(1) }}
            />
          </Card>
        </>
      )}

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

      <Drawer open={chatOpen} onClose={() => setChatOpen(false)} title={t('reports:chat.title', 'Security assistant')} subtitle="Powered by Gemini · your data stays in your organization">
        <ChatPanel servers={servers} />
      </Drawer>
    </PageShell>
  )
}

function inProgressHint(summary: Summary): boolean {
  return (summary.GENERATING ?? 0) + (summary.PENDING ?? 0) > 0
}
