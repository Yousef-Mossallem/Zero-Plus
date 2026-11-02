// frontend/src/pages/reports/ReportDrawer.tsx
// ==================================================================
// تفاصيل تقرير واحد → GET /reports/:id  (فيه content / summary / metadata)
//  - PENDING / GENERATING: مفيش محتوى، بنعرض حالة "جاري التوليد" متحركة
//    وبنعيد الجلب أوتوماتيك أول ما الصفحة تبلغنا إن الحالة اتغيرت (prop status)
//  - READY: الملخص + المحتوى بـ Markdown آمن
//  - FAILED: رسالة الخطأ errorMessage
//  - الحذف: OWNER/ADMIN بس (DELETE /reports/:id) بتأكيد
// ==================================================================

import { useEffect, useState } from 'react'
import { CalendarRange, Cpu, FileText, Loader2, ShieldAlert, Trash2 } from 'lucide-react'

import { useToast } from '../../components/ui/Toast'
import { Button, Drawer, Modal, Skeleton } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { deleteReport, getReport, type Report } from '../../services/reportsService'
import { formatDateTime, formatNumber } from '../../utils/format'
import Markdown from './Markdown'
import { ReportStatusBadge, TYPE_META } from './shared'

export default function ReportDrawer({
  report,
  canDelete,
  onClose,
  onDeleted,
}: {
  /** الصف من القايمة (حالته بتتحدث لحظيًا من السوكيت) */
  report: Report | null
  canDelete: boolean
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const toast = useToast()
  const [full, setFull] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // بنجيب التفاصيل لما يتغير التقرير أو حالته (مثلاً GENERATING → READY)
  const id = report?.id
  const status = report?.status
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getReport(id)
      .then((data) => {
        if (!cancelled) setFull(data)
      })
      .catch((err) => {
        if (cancelled) return
        const { message, status: code } = parseApiError(err)
        setError(code === 404 ? 'This report no longer exists.' : message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, status])

  useEffect(() => {
    if (!id) setFull(null)
  }, [id])

  const current = full && full.id === id ? full : report
  const waiting = current?.status === 'PENDING' || current?.status === 'GENERATING'

  const confirmDelete = async () => {
    if (!current) return
    setDeleting(true)
    try {
      const res = await deleteReport(current.id)
      toast.success(res.message || 'Report deleted')
      onDeleted(current.id)
      setConfirmOpen(false)
      onClose()
    } catch (err) {
      toast.error('Could not delete the report', parseApiError(err).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Drawer
        open={report !== null}
        onClose={onClose}
        title={current?.title ?? 'Report'}
        subtitle={current ? `${TYPE_META[current.type].label} · created ${formatDateTime(current.createdAt)}` : undefined}
      >
        {current && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <ReportStatusBadge status={current.status} />
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarRange className="h-3.5 w-3.5" />
                {formatDateTime(current.periodStart)} → {formatDateTime(current.periodEnd)}
              </span>
            </div>

            {/* ---------- إحصائيات ---------- */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Events', value: formatNumber(current.eventCount), icon: ShieldAlert },
                { label: 'Blocked', value: formatNumber(current.blockedCount), icon: ShieldAlert },
                { label: 'Tokens', value: formatNumber(current.tokensUsed), icon: Cpu },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-white/8 bg-white/3 p-3.5">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">{s.label}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{s.value}</p>
                </div>
              ))}
            </div>

            {/* ---------- حسب الحالة ---------- */}
            {waiting ? (
              <div className="flex flex-col items-center rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-6 py-10 text-center">
                <span className="zp-anim-pulse-ring flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-300">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </span>
                <p className="mt-4 text-sm font-semibold text-white">
                  {current.status === 'PENDING' ? 'Waiting in the queue…' : 'Generating your report…'}
                </p>
                <p className="mt-1 max-w-xs text-xs text-slate-400">
                  This page updates by itself as soon as the report is ready. You can close it safely.
                </p>
              </div>
            ) : current.status === 'FAILED' ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/8 p-5">
                <p className="text-sm font-semibold text-rose-200">Generation failed</p>
                <p dir="auto" className="mt-1 text-sm text-rose-100/80">
                  {current.errorMessage ?? 'The report could not be generated. Try creating it again.'}
                </p>
              </div>
            ) : loading && !full ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-40 w-full rounded-xl" />
              </div>
            ) : error ? (
              <p className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">{error}</p>
            ) : (
              <>
                {current.summary && (
                  <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
                    <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">
                      <FileText className="h-3.5 w-3.5" /> Summary
                    </p>
                    <p dir="auto" className="text-sm leading-relaxed text-slate-200">{current.summary}</p>
                  </div>
                )}
                {current.content ? (
                  <Markdown source={current.content} />
                ) : (
                  <p className="text-sm text-slate-500">This report has no content.</p>
                )}
                {current.modelUsed && <p className="text-xs text-slate-600">Generated by {current.modelUsed}</p>}
              </>
            )}

            {canDelete && (
              <Button variant="danger" icon={Trash2} className="w-full" onClick={() => setConfirmOpen(true)}>
                Delete report
              </Button>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={confirmOpen}
        onClose={deleting ? () => {} : () => setConfirmOpen(false)}
        title="Delete this report?"
        description="The report and its content are removed permanently."
        icon={Trash2}
        tone="rose"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>Delete</Button>
          </>
        }
      />
    </>
  )
}
