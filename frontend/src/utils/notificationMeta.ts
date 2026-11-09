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

import i18n from '../i18n'
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

function typeMeta(key: NotificationType, icon: IconType): { label: string; icon: IconType } {
  return {
    get label() {
      return i18n.t(`types.${key}`, { ns: 'notifications', defaultValue: key })
    },
    icon,
  }
}

/** أيقونة واسم كل نوع */
export const TYPE_META: Record<NotificationType, { label: string; icon: IconType }> = {
  DDOS_START: typeMeta('DDOS_START', ShieldAlert),
  NEW_BLOCK: typeMeta('NEW_BLOCK', Ban),
  CRITICAL_REPUTATION: typeMeta('CRITICAL_REPUTATION', Fingerprint),
  SERVER_CAPACITY_WARNING: typeMeta('SERVER_CAPACITY_WARNING', Gauge),
  SERVER_RECOVERY: typeMeta('SERVER_RECOVERY', CheckCircle2),
  POLICY_CHANGED: typeMeta('POLICY_CHANGED', SlidersHorizontal),
  REPORT_READY: typeMeta('REPORT_READY', FileText),
  SYSTEM: typeMeta('SYSTEM', Info),
}

/** أسماء الشدة (1 معلوماتي … 5 طارئ) */
export const SEVERITY_LABELS: Record<number, string> = {
  get 1() { return i18n.t('severities.1', { ns: 'notifications', defaultValue: 'Info' }) },
  get 2() { return i18n.t('severities.2', { ns: 'notifications', defaultValue: 'Notice' }) },
  get 3() { return i18n.t('severities.3', { ns: 'notifications', defaultValue: 'Important' }) },
  get 4() { return i18n.t('severities.4', { ns: 'notifications', defaultValue: 'Critical' }) },
  get 5() { return i18n.t('severities.5', { ns: 'notifications', defaultValue: 'Emergency' }) },
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
