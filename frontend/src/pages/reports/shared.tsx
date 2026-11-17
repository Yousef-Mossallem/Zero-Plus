// frontend/src/pages/reports/shared.tsx
// ==================================================================
// ثوابت وعناصر عرض مشتركة للتقارير
//   الحالات: PENDING (رمادي) → GENERATING (تحميل) → READY (أخضر) | FAILED (أحمر)
//   الأنواع: PERIODIC | INCIDENT | ON_DEMAND
// ==================================================================

import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'

import { Badge, type Tone } from '../../components/ui/kit'
import i18n from '../../i18n'
import type { Report, ReportStatus, ReportType } from '../../services/reportsService'
import { formatDate } from '../../utils/format'

export const MANAGE_ROLES = ['OWNER', 'ADMIN']

export const STATUS_META: Record<ReportStatus, { label: string; tone: Tone }> = {
  get PENDING() { return { label: i18n.t('reports:status.PENDING', 'Pending'), tone: 'slate' as Tone } },
  get GENERATING() { return { label: i18n.t('reports:status.GENERATING', 'Generating'), tone: 'amber' as Tone } },
  get READY() { return { label: i18n.t('reports:status.READY', 'Ready'), tone: 'emerald' as Tone } },
  get FAILED() { return { label: i18n.t('reports:status.FAILED', 'Failed'), tone: 'rose' as Tone } },
}

export const TYPE_META: Record<ReportType, { label: string; tone: Tone }> = {
  get PERIODIC() { return { label: i18n.t('reports:types.PERIODIC', 'Periodic'), tone: 'cyan' as Tone } },
  get INCIDENT() { return { label: i18n.t('reports:types.INCIDENT', 'Incident'), tone: 'rose' as Tone } },
  get ON_DEMAND() { return { label: i18n.t('reports:types.ON_DEMAND', 'On demand'), tone: 'indigo' as Tone } },
}

/** نفس الأنواع كنصوص بس (للأزرار والفلاتر) */
export const TYPE_LABEL: Record<ReportType, string> = {
  get PERIODIC() { return TYPE_META.PERIODIC.label },
  get INCIDENT() { return TYPE_META.INCIDENT.label },
  get ON_DEMAND() { return TYPE_META.ON_DEMAND.label },
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
