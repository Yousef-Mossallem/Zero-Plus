// frontend/src/pages/reports/shared.tsx
// ==================================================================
// ثوابت وعناصر عرض مشتركة للتقارير
//   الحالات: PENDING (رمادي) → GENERATING (تحميل) → READY (أخضر) | FAILED (أحمر)
//   الأنواع: PERIODIC | INCIDENT | ON_DEMAND
// ==================================================================

import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'

import { Badge, type Tone } from '../../components/ui/kit'
import type { Report, ReportStatus, ReportType } from '../../services/reportsService'
import { formatDate } from '../../utils/format'

export const MANAGE_ROLES = ['OWNER', 'ADMIN']

export const STATUS_META: Record<ReportStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'slate' },
  GENERATING: { label: 'Generating', tone: 'amber' },
  READY: { label: 'Ready', tone: 'emerald' },
  FAILED: { label: 'Failed', tone: 'rose' },
}

export const TYPE_META: Record<ReportType, { label: string; tone: Tone }> = {
  PERIODIC: { label: 'Periodic', tone: 'cyan' },
  INCIDENT: { label: 'Incident', tone: 'rose' },
  ON_DEMAND: { label: 'On demand', tone: 'indigo' },
}

/** نفس الأنواع كنصوص بس (للأزرار والفلاتر) */
export const TYPE_LABEL: Record<ReportType, string> = {
  PERIODIC: TYPE_META.PERIODIC.label,
  INCIDENT: TYPE_META.INCIDENT.label,
  ON_DEMAND: TYPE_META.ON_DEMAND.label,
}

/** Badge الحالة: GENERATING بيلف، READY أخضر، FAILED أحمر */
export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const meta = STATUS_META[status]
  const Icon =
    status === 'GENERATING' ? Loader2 : status === 'READY' ? CheckCircle2 : status === 'FAILED' ? XCircle : Clock
  return (
    <Badge tone={meta.tone}>
      <Icon className={`h-3 w-3 ${status === 'GENERATING' ? 'animate-spin' : ''}`} />
      {meta.label}
    </Badge>
  )
}

export function periodLabel(r: Pick<Report, 'periodStart' | 'periodEnd'>): string {
  return `${formatDate(r.periodStart)} → ${formatDate(r.periodEnd)}`
}

/** ISO → قيمة input datetime-local (بتوقيت المستخدم) */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** اسم قديم محفوظ عشان أي استيراد سابق مايتكسرش */
export const StatusBadge = ReportStatusBadge
