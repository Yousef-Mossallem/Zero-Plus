// frontend/src/pages/team/shared.ts
// أنواع وأدوات مشتركة بين صفحات الفريق

import i18n from 'i18next'
import type { TeamRole } from '../../services/teamService'

export function formatRole(role: TeamRole | string): string {
  // المفتاح ديناميكي (حسب الدور) فمنعدّي على الـ typed keys
  const tr = i18n.t.bind(i18n) as (key: string, opts?: Record<string, unknown>) => string
  return tr(`team:roles.${String(role).toLowerCase()}`, { defaultValue: String(role) })
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
  return isActive
    ? 'text-emerald-300 bg-emerald-500/10'
    : 'text-slate-400 bg-slate-500/10'
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

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString((i18n.language?.startsWith('ar') ? 'ar-EG' : 'en-US'), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString((i18n.language?.startsWith('ar') ? 'ar-EG' : 'en-US'), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
