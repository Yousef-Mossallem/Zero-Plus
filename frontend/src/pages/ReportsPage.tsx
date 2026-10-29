// frontend/src/pages/ReportsPage.tsx
// ==================================================================
// Zero Plus - Reports Page
// Security reports (backend/modules/reports)
// Design language: identical to PoliciesPage (Section + cyan icon headers)
// ==================================================================

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
  Sparkles,
  type LucideIcon,
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
  TextInput,
  Modal,
} from '../components/ui/kit'
import { Section } from '../components/ui/Section'
import { parseApiError } from '../services/apiError'
import { reportsService, type CreateReportPayload, type ReportsQuery } from '../services/reportsService'
import { listServers, type Server } from '../services/serversService'
import type { Report, ReportStatus, ReportType } from '../services/types'
import { cn, formatDate, timeAgo } from '../utils/format'
import useAuthStore from '../store/authStore'

// ==================================================================
// Constants
// ==================================================================

const PAGE_SIZE = 12

const STATUS_META: Record<
  ReportStatus,
  { label: string; color: string; icon: LucideIcon; bg: string }
> = {
  PENDING: {
    label: 'Pending',
    color: 'text-slate-400',
    icon: Clock,
    bg: 'bg-slate-500/10 border-slate-500/20',
  },
  GENERATING: {
    label: 'Generating',
    color: 'text-amber-400',
    icon: Loader2,
    bg: 'bg-amber-500/10 border-amber-500/20',
  },
  READY: {
    label: 'Ready',
    color: 'text-emerald-400',
    icon: CheckCircle2,
    bg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  FAILED: {
    label: 'Failed',
    color: 'text-rose-400',
    icon: XCircle,
    bg: 'bg-rose-500/10 border-rose-500/20',
  },
}

const TYPE_META: Record<ReportType, { label: string; color: string }> = {
  PERIODIC: { label: 'Periodic', color: 'text-cyan-400' },
  INCIDENT: { label: 'Incident', color: 'text-rose-400' },
  ON_DEMAND: { label: 'On demand', color: 'text-purple-400' },
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'PERIODIC', label: 'Periodic' },
  { value: 'INCIDENT', label: 'Incident' },
  { value: 'ON_DEMAND', label: 'On demand' },
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'GENERATING', label: 'Generating' },
  { value: 'READY', label: 'Ready' },
  { value: 'FAILED', label: 'Failed' },
]

function getDefaultPeriod() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  }
}

// ==================================================================
// Page
// ==================================================================

export default function ReportsPage() {
  const toast = useToast()
  const user = useAuthStore((s) => s.user)
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN'

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
  })
  const [servers, setServers] = useState<Server[]>([])

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)

  const [createOpen, setCreateOpen] = useState(false)
  const [detailReport, setDetailReport] = useState<Report | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [createForm, setCreateForm] = useState<CreateReportPayload>({
    type: 'ON_DEMAND',
    ...getDefaultPeriod(),
    title: '',
    serverId: undefined,
  })
  const [creating, setCreating] = useState(false)

  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // ---------------- Fetch ----------------
  const fetchReports = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      else setRefreshing(true)
      setError(null)

      try {
        const query: ReportsQuery = {
          page,
          limit: PAGE_SIZE,
          search: search.trim() || undefined,
          type: typeFilter !== 'all' ? (typeFilter as ReportType) : undefined,
          status: statusFilter !== 'all' ? (statusFilter as ReportStatus) : undefined,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        }

        const res = await reportsService.list(query)
        setReports(res.data ?? [])
        setPagination(
          res.pagination ?? {
            page: 1,
            limit: PAGE_SIZE,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
          },
        )
      } catch (err) {
        const msg = parseApiError(err).message || String(err)
        setError(msg)
        if (!opts?.silent) toast.error('Load failed', msg)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [page, search, typeFilter, statusFilter, toast],
  )

  const fetchServers = useCallback(async () => {
    try {
      const res = await listServers({ limit: 100 })
      setServers(res.data ?? [])
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  useEffect(() => {
    fetchServers()
  }, [fetchServers])

  useEffect(() => {
    const hasPending = reports.some((r) => r.status === 'PENDING' || r.status === 'GENERATING')
    if (!hasPending) return
    const timer = setInterval(() => fetchReports({ silent: true }), 8000)
    return () => clearInterval(timer)
  }, [reports, fetchReports])

  // ---------------- Handlers ----------------
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      await reportsService.create({
        type: createForm.type,
        periodStart: new Date(createForm.periodStart).toISOString(),
        periodEnd: new Date(createForm.periodEnd).toISOString(),
        title: createForm.title?.trim() || undefined,
        serverId: createForm.serverId || undefined,
      })
      toast.success('Created', 'Report is being generated')
      setCreateOpen(false)
      setCreateForm({ type: 'ON_DEMAND', ...getDefaultPeriod(), title: '', serverId: undefined })
      setPage(1)
      await fetchReports({ silent: true })
    } catch (err) {
      toast.error('Create failed', parseApiError(err).message)
    } finally {
      setCreating(false)
    }
  }

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setDetailReport(null)
    try {
      setDetailReport(await reportsService.getById(id))
    } catch (err) {
      toast.error('Load failed', parseApiError(err).message)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId || deleting) return
    setDeleting(true)
    try {
      await reportsService.remove(deleteId)
      toast.success('Deleted')
      setDeleteId(null)
      if (detailReport?.id === deleteId) setDetailReport(null)
      await fetchReports({ silent: true })
    } catch (err) {
      toast.error('Delete failed', parseApiError(err).message)
    } finally {
      setDeleting(false)
    }
  }

  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    setChatMessages((prev) => [...prev, { role: 'user', content: msg }])
    setChatInput('')
    setChatLoading(true)
    try {
      const res = await reportsService.chat({
        message: msg,
        messages: chatMessages,
        includeContext: true,
      })
      setChatMessages((prev) => [...prev, { role: 'assistant', content: res.reply }])
    } catch (err) {
      toast.error('Chat failed', parseApiError(err).message)
      setChatMessages((prev) => prev.slice(0, -1))
    } finally {
      setChatLoading(false)
    }
  }

  const statusBadge = (status: ReportStatus) => {
    const meta = STATUS_META[status]
    const Icon = meta.icon
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
          meta.bg,
          meta.color,
        )}
      >
        <Icon className={cn('h-3.5 w-3.5', status === 'GENERATING' && 'animate-spin')} />
        {meta.label}
      </span>
    )
  }

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      <PageHeader
        icon={FileText}
        title="Security Reports"
        subtitle="Create and review AI-generated security reports"
        actions={
          <>
            <Button
              variant="ghost"
              icon={MessageSquare}
              onClick={() => {
                setChatOpen(true)
                setChatMessages([])
              }}
            >
              AI Chat
            </Button>
            <Button
              variant="ghost"
              icon={RefreshCw}
              loading={refreshing}
              onClick={() => fetchReports({ silent: true })}
            >
              Refresh
            </Button>
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              New report
            </Button>
          </>
        }
      />

      {/* Filters Section — same style as Policies */}
      <Section
        icon={Filter}
        title="Filters"
        description="Search and filter reports by type and status"
        delay={0}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextInput
              placeholder="Search title or summary..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              icon={Search}
            />
          </div>
          <div className="w-full sm:w-44">
            <SelectInput
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value)
                setPage(1)
              }}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900">
                  {o.label}
                </option>
              ))}
            </SelectInput>
          </div>
          <div className="w-full sm:w-44">
            <SelectInput
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900">
                  {o.label}
                </option>
              ))}
            </SelectInput>
          </div>
        </div>
      </Section>

      {/* Content */}
      {loading ? (
        <div className="mt-6 space-y-6">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="mt-6">
          <Card>
            <ErrorState message={error} onRetry={() => fetchReports()} />
          </Card>
        </div>
      ) : reports.length === 0 ? (
        <div className="mt-6">
          <Card>
            <EmptyState
              icon={FileText}
              title="No reports yet"
              description="Create a security report to generate an AI summary"
              action={
                <Button icon={Plus} onClick={() => setCreateOpen(true)}>
                  Create report
                </Button>
              }
            />
          </Card>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <Section
            icon={FileText}
            title="Reports"
            description={`${pagination.total} Report`}
            delay={40}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {reports.map((report, idx) => (
                <div
                  key={report.id}
                  className={cn(
                    'group cursor-pointer rounded-xl border border-white/6 bg-white/2 p-4 transition-all',
                    'hover:border-cyan-500/30 hover:bg-white/[0.04]',
                  )}
                  style={{ animationDelay: `${idx * 40}ms` }}
                  onClick={() => openDetail(report.id)}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-sm font-semibold text-white group-hover:text-cyan-300">
                      {report.title || `Report ${TYPE_META[report.type]?.label ?? report.type}`}
                    </h3>
                    {statusBadge(report.status)}
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className={cn('font-medium', TYPE_META[report.type]?.color)}>
                      {TYPE_META[report.type]?.label}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(report.periodStart)}
                    </span>
                  </div>

                  {report.summary && (
                    <p className="mb-3 line-clamp-2 text-xs text-slate-500">{report.summary}</p>
                  )}

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{timeAgo(report.createdAt)}</span>
                    <div className="flex items-center gap-3">
                      {report.eventCount > 0 && (
                        <span className="text-slate-400">{report.eventCount} events</span>
                      )}
                      {report.blockedCount > 0 && (
                        <span className="text-rose-400/80">{report.blockedCount} blocked</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {pagination.totalPages > 1 && (
              <div className="pt-2">
                <PaginationBar
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  total={pagination.total}
                  limit={PAGE_SIZE}
                  onPage={setPage}
                />
              </div>
            )}
          </Section>
        </div>
      )}

      {/* Create Modal */}
      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Create report"
      >
        <form onSubmit={handleCreate} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm text-slate-400">Report type</label>
            <SelectInput
              value={createForm.type}
              onChange={(e) => setCreateForm((f) => ({ ...f, type: e.target.value as ReportType }))}
            >
              <option value="ON_DEMAND" className="bg-slate-900">On demand</option>
              <option value="PERIODIC" className="bg-slate-900">Periodic</option>
              <option value="INCIDENT" className="bg-slate-900">Incident</option>
            </SelectInput>
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-slate-400">Title (optional)</label>
            <TextInput
              value={createForm.title ?? ''}
              onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Weekly report — Oct 2026"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-slate-400">Period start</label>
              <TextInput
                type="datetime-local"
                value={createForm.periodStart.slice(0, 16)}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    periodStart: new Date(e.target.value).toISOString(),
                  }))
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-slate-400">Period end</label>
              <TextInput
                type="datetime-local"
                value={createForm.periodEnd.slice(0, 16)}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    periodEnd: new Date(e.target.value).toISOString(),
                  }))
                }
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-slate-400">Server (optional)</label>
            <SelectInput
              value={createForm.serverId ?? ''}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, serverId: e.target.value || undefined }))
              }
            >
              <option value="" className="bg-slate-900">All servers</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900">
                  {s.domain}
                </option>
              ))}
            </SelectInput>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" loading={creating} icon={Sparkles}>
              Create & generate
            </Button>
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        open={!!detailReport || detailLoading}
        onClose={() => {
          setDetailReport(null)
          setDetailLoading(false)
        }}
        title={detailReport?.title || 'Report details'}
      >
        {detailLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : detailReport ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              {statusBadge(detailReport.status)}
              <span className={cn('text-sm font-medium', TYPE_META[detailReport.type]?.color)}>
                {TYPE_META[detailReport.type]?.label}
              </span>
              <span className="text-xs text-slate-500">{formatDate(detailReport.createdAt)}</span>
            </div>

            <div className="grid gap-3 rounded-xl border border-white/6 bg-white/2 p-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-slate-500">Period:</span>{' '}
                <span className="text-slate-300">
                  {formatDate(detailReport.periodStart)} – {formatDate(detailReport.periodEnd)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Events:</span>{' '}
                <span className="text-slate-300">{detailReport.eventCount}</span>
              </div>
              <div>
                <span className="text-slate-500">Blocked:</span>{' '}
                <span className="text-rose-400">{detailReport.blockedCount}</span>
              </div>
              {detailReport.modelUsed && (
                <div>
                  <span className="text-slate-500">Model:</span>{' '}
                  <span className="text-slate-300">{detailReport.modelUsed}</span>
                </div>
              )}
            </div>

            {detailReport.status === 'FAILED' && detailReport.errorMessage && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-300">
                <AlertTriangle className="mb-1 inline h-4 w-4" /> {detailReport.errorMessage}
              </div>
            )}

            {detailReport.summary && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-slate-300">Summary</h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
                  {detailReport.summary}
                </p>
              </div>
            )}

            {detailReport.content && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-slate-300">Full content</h4>
                <div className="max-h-96 overflow-y-auto rounded-xl border border-white/6 bg-black/30 p-4">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                    {detailReport.content}
                  </pre>
                </div>
              </div>
            )}

            {(detailReport.status === 'PENDING' || detailReport.status === 'GENERATING') && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Report is generating… this page will refresh automatically.
              </div>
            )}

            <div className="flex justify-between pt-2">
              {canManage && (
                <Button variant="danger" icon={Trash2} onClick={() => setDeleteId(detailReport.id)}>
                  Delete
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDetailReport(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Delete Confirm */}
      <Modal open={!!deleteId} onClose={() => !deleting && setDeleteId(null)} title="Confirm delete">
        <p className="mb-6 text-sm text-slate-400">
          Delete this report? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteId(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" loading={deleting} icon={Trash2} onClick={handleDelete}>
            Delete permanently
          </Button>
        </div>
      </Modal>

      {/* AI Chat */}
      <Modal
        open={chatOpen}
        onClose={() => !chatLoading && setChatOpen(false)}
        title="AI assistant"
      >
        <div className="flex h-[28rem] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-white/6 bg-black/20 p-4">
            {chatMessages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                <Sparkles className="mb-3 h-8 w-8 text-cyan-500/50" />
                <p className="text-sm">Ask about reports or your current security posture</p>
                <p className="mt-1 text-xs">e.g. What were the top threats this week?</p>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  m.role === 'user'
                    ? 'ml-auto bg-cyan-600/20 text-cyan-100'
                    : 'mr-auto bg-white/5 text-slate-300',
                )}
              >
                {m.content}
              </div>
            ))}
            {chatLoading && (
              <div className="mr-auto flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <TextInput
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type your question…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendChat()
                }
              }}
              disabled={chatLoading}
            />
            <Button onClick={sendChat} loading={chatLoading} disabled={!chatInput.trim()}>
              Send
            </Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  )
}
