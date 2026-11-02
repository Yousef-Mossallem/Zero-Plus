// frontend/src/pages/reports/ReportCard.tsx
// ==================================================================
// كارت تقرير واحد (تصميم الكروت بدل الصفوف)
//   - خط علوي ملوّن حسب الحالة
//   - شريط يوضح نسبة المحجوب من إجمالي الأحداث
// ==================================================================

import { Activity, Ban, CalendarRange, FileText } from 'lucide-react'

import { Badge } from '../../components/ui/kit'
import type { Report } from '../../services/reportsService'
import { cn, formatNumber, timeAgo } from '../../utils/format'
import { ReportStatusBadge, TYPE_META, periodLabel } from './shared'

const STATUS_LINE: Record<Report['status'], string> = {
  READY: 'from-emerald-400/70',
  GENERATING: 'from-amber-300/70',
  FAILED: 'from-rose-400/70',
  PENDING: 'from-slate-500/60',
}

const STATUS_ICON: Record<Report['status'], string> = {
  READY: 'bg-emerald-500/10 text-emerald-400',
  GENERATING: 'bg-amber-400/10 text-amber-300',
  FAILED: 'bg-rose-500/10 text-rose-400',
  PENDING: 'bg-white/5 text-slate-400',
}

export default function ReportCard({
  report: r,
  index,
  onOpen,
}: {
  report: Report
  index: number
  onOpen: () => void
}) {
  const ratio = r.eventCount > 0 ? Math.min(1, r.blockedCount / r.eventCount) : 0
  const type = TYPE_META[r.type]

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className="zp-anim-fade-up group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-5 text-left shadow-xl shadow-black/30 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-cyan-400/30 hover:bg-white/5"
    >
      <div className={cn('absolute inset-x-0 top-0 h-0.5 bg-linear-to-r to-transparent', STATUS_LINE[r.status])} />

      <div className="flex items-start justify-between gap-3">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', STATUS_ICON[r.status])}>
          <FileText className="h-5 w-5" />
        </span>
        <ReportStatusBadge status={r.status} />
      </div>

      <h3 dir="auto" className="mt-4 line-clamp-2 text-base font-semibold leading-snug text-white">
        {r.title}
      </h3>

      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
        <CalendarRange className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{periodLabel(r)}</span>
      </p>

      {r.status === 'FAILED' && r.errorMessage && (
        <p dir="auto" className="mt-2 line-clamp-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 text-xs text-rose-300/90">
          {r.errorMessage}
        </p>
      )}

      {/* Block ratio */}
      <div className="mt-auto pt-5">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            {formatNumber(r.eventCount)} events
          </span>
          <span className="flex items-center gap-1.5">
            <Ban className="h-3.5 w-3.5 text-rose-400" />
            {formatNumber(r.blockedCount)} blocked · {Math.round(ratio * 100)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
          <div
            className="zp-anim-bar h-full rounded-full bg-linear-to-r from-cyan-400 to-rose-400"
            style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 3 : 0)}%` }}
          />
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
          <Badge tone={type.tone}>{type.label}</Badge>
          <span className="text-[11px] text-slate-600">{timeAgo(r.createdAt)}</span>
        </div>
      </div>
    </button>
  )
}
