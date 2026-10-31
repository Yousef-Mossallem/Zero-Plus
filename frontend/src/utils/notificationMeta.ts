// frontend/src/utils/notificationMeta.ts
// ==================================================================
// Zero Plus - Notification Meta
// بيربط كل NotificationType (من Prisma/الباك) بأيقونة واسم ولون
// ومعاه شدة الإشعار (severity 1-5) → لون التوست والـ Badge
// الأنواع لازم تطابق enum NotificationType في schema.prisma
// ==================================================================

import type { ComponentType } from 'react'
import {
  Ban,
  CheckCircle2,
  FileText,
  Fingerprint,
  Gauge,
  Info,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react'

import type { Tone } from '../components/ui/kit'

export type NotificationType =
  | 'DDOS_START'
  | 'NEW_BLOCK'
  | 'CRITICAL_REPUTATION'
  | 'SERVER_CAPACITY_WARNING'
  | 'SERVER_RECOVERY'
  | 'POLICY_CHANGED'
  | 'REPORT_READY'
  | 'SYSTEM'

export const NOTIFICATION_TYPES: NotificationType[] = [
  'DDOS_START',
  'NEW_BLOCK',
  'CRITICAL_REPUTATION',
  'SERVER_CAPACITY_WARNING',
  'SERVER_RECOVERY',
  'POLICY_CHANGED',
  'REPORT_READY',
  'SYSTEM',
]

type IconType = ComponentType<{ className?: string }>

/** أيقونة واسم كل نوع */
export const TYPE_META: Record<NotificationType, { label: string; icon: IconType }> = {
  DDOS_START: { label: 'Attack / surge', icon: ShieldAlert },
  NEW_BLOCK: { label: 'New block', icon: Ban },
  CRITICAL_REPUTATION: { label: 'Critical reputation', icon: Fingerprint },
  SERVER_CAPACITY_WARNING: { label: 'Capacity warning', icon: Gauge },
  SERVER_RECOVERY: { label: 'Server recovery', icon: CheckCircle2 },
  POLICY_CHANGED: { label: 'Policy changed', icon: SlidersHorizontal },
  REPORT_READY: { label: 'Report ready', icon: FileText },
  SYSTEM: { label: 'System', icon: Info },
}

/** أسماء الشدة (1 معلوماتي … 5 طارئ) */
export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Info',
  2: 'Notice',
  3: 'Important',
  4: 'Critical',
  5: 'Emergency',
}

export interface NotificationVisual {
  tone: Tone
  /** كلاسات التوست */
  ring: string
  iconCls: string
  bar: string
  /** لون الشريط الجانبي في صف الصفحة */
  accent: string
}

const VISUALS: Record<'danger' | 'warning' | 'success' | 'info', NotificationVisual> = {
  danger: {
    tone: 'rose',
    ring: 'border-rose-500/35',
    iconCls: 'text-rose-400 bg-rose-500/10',
    bar: 'bg-rose-400',
    accent: 'bg-rose-400',
  },
  warning: {
    tone: 'amber',
    ring: 'border-amber-400/35',
    iconCls: 'text-amber-400 bg-amber-400/10',
    bar: 'bg-amber-400',
    accent: 'bg-amber-400',
  },
  success: {
    tone: 'emerald',
    ring: 'border-emerald-400/30',
    iconCls: 'text-emerald-400 bg-emerald-400/10',
    bar: 'bg-emerald-400',
    accent: 'bg-emerald-400',
  },
  info: {
    tone: 'cyan',
    ring: 'border-cyan-400/30',
    iconCls: 'text-cyan-400 bg-cyan-400/10',
    bar: 'bg-cyan-400',
    accent: 'bg-cyan-400',
  },
}

/** الشدة تحدد اللون، والاستعادة (SERVER_RECOVERY) دايمًا أخضر */
export function visualFor(type: NotificationType, severity: number): NotificationVisual {
  if (type === 'SERVER_RECOVERY' || type === 'REPORT_READY') return VISUALS.success
  if (severity >= 4) return VISUALS.danger
  if (severity === 3) return VISUALS.warning
  return VISUALS.info
}

/** type غير معروف (باك أحدث من الفرونت) → SYSTEM بدل ما الصفحة تكسر */
export function metaFor(type: string) {
  return TYPE_META[type as NotificationType] ?? TYPE_META.SYSTEM
}
