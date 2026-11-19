// frontend/src/pages/team/shared.ts
// أدوات مشتركة بين تبويبات الفريق — كل النصوص من نظام i18n (namespace: team)

import i18n from '../../i18n'
import type { TeamRole } from '../../services/teamService'

const lang = () => (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0]
const locale = () => (lang() === 'ar' ? 'ar-EG' : lang() === 'de' ? 'de-DE' : lang() === 'zh' ? 'zh-CN' : 'en-US')

export function formatRole(role: TeamRole | string): string {
  return i18n.t(`roles.${String(role).toLowerCase()}` as 'roles.admin', { ns: 'team', defaultValue: String(role) })
}

export function formatInviteStatus(status: string): string {
  return i18n.t(`status.${String(status).toLowerCase()}` as 'status.pending', { ns: 'team', defaultValue: String(status) })
}

export function roleColor(role: TeamRole | string): string {
  const map: Record<string, string> = {
    OWNER: 'text-amber-300 bg-amber-500/10 border-amber-400/20',
    ADMIN: 'text-cyan-300 bg-cyan-500/10 border-cyan-400/20',
    ANALYST: 'text-indigo-300 bg-indigo-500/10 border-indigo-400/20',
    VIEWER: 'text-slate-300 bg-slate-500/10 border-slate-400/20',
  }
  return map[role] ?? 'text-slate-300 bg-slate-500/10 border-slate-400/20'
}

export function statusColor(isActive: boolean): string {
  return isActive ? 'text-emerald-300 bg-emerald-500/10' : 'text-slate-400 bg-slate-500/10'
}

export function inviteStatusColor(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'text-amber-300 bg-amber-500/10 border-amber-400/20',
    ACCEPTED: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/20',
    EXPIRED: 'text-slate-400 bg-slate-500/10 border-slate-400/20',
    REVOKED: 'text-rose-300 bg-rose-500/10 border-rose-400/20',
  }
  return map[status] ?? 'text-slate-400 bg-slate-500/10 border-slate-400/20'
}

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDate(iso: string | null | undefined): string {
  const d = safeDate(iso)
  return d ? d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = safeDate(iso)
  return d
    ? d.toLocaleString(locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'
}

/** اسم الصلاحية حسب لغة الواجهة (الكتالوج بيرجع ar/en) */
export function permLabel(p: { ar?: string; en?: string; id: string }): string {
  return (lang() === 'ar' ? p.ar : p.en) || p.en || p.ar || p.id
}
