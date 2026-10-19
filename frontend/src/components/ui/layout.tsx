// frontend/src/components/ui/layout.tsx
// الهيكل العام والكروت والـ Badges

import type { ReactNode } from 'react'

import Navbar from '../Navbar'
import { cn } from '../../utils/format'
import type { Decision } from '../../services/types'
import { TONE_BADGE, TONE_ICON, type IconType, type Tone } from './tones'

// ==================================================================
// PageShell: الهيكل العام (Navbar + محتوى الصفحة)
// ملاحظة: dir="ltr" لأن الـ Navbar ثابت على الشمال والـ html عليه rtl
// ==================================================================

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div dir="ltr" className="relative flex min-h-screen w-full text-white">
      {/* توهجات خلفية ثابتة */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 top-1/4 h-105 w-105 rounded-full bg-cyan-500/8 blur-[120px]" />
        <div className="absolute -right-40 bottom-1/4 h-95 w-95 rounded-full bg-indigo-600/10 blur-[110px]" />
      </div>

      <Navbar />

      {/* pt-20 على الموبايل عشان الـ Top Bar الثابت (h-14) */}
      <main className="min-w-0 flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-8 lg:pt-8">
        <div className="mx-auto w-full max-w-7xl space-y-6">{children}</div>
      </main>
    </div>
  )
}

// ==================================================================
// PageHeader
// ==================================================================

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: IconType
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="zp-anim-fade-up flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-cyan-400/20 to-blue-600/20 text-cyan-300 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-400/20">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ==================================================================
// Card
// ==================================================================

export function Card({
  children,
  className,
  delay = 0,
  accent = false,
}: {
  children: ReactNode
  className?: string
  /** تأخير الانيميشن بالـ ms (للظهور المتتابع) */
  delay?: number
  /** خط لامع أعلى الكارت (زي كارت الـ Login) */
  accent?: boolean
}) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        'zp-anim-fade-up relative overflow-hidden rounded-2xl border border-white/8 bg-white/3 shadow-xl shadow-black/30 backdrop-blur-xl',
        className,
      )}
    >
      {accent && (
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />
      )}
      {children}
    </div>
  )
}

// ==================================================================
// StatCard
// ==================================================================

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'cyan',
  hint,
  loading = false,
  delay = 0,
}: {
  label: string
  value: ReactNode
  icon: IconType
  tone?: Tone
  hint?: string
  loading?: boolean
  delay?: number
}) {
  return (
    <Card delay={delay} className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          {loading ? (
            <div className="zp-skeleton mt-2 h-8 w-20 rounded-md" />
          ) : (
            <p className="mt-1.5 truncate text-3xl font-bold tracking-tight text-white">
              {value}
            </p>
          )}
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            TONE_ICON[tone],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  )
}

// ==================================================================
// Badge
// ==================================================================

export function Badge({
  tone = 'slate',
  children,
  dot = false,
  className,
}: {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** Badge جاهز لقرار الـ Gateway */
const DECISION_TONE: Record<Decision, Tone> = {
  ALLOW: 'emerald',
  MONITOR: 'cyan',
  RATE_LIMIT: 'amber',
  CHALLENGE: 'indigo',
  BLOCK: 'rose',
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  return (
    <Badge tone={DECISION_TONE[decision] ?? 'slate'} dot>
      {decision.replace('_', ' ')}
    </Badge>
  )
}

// ==================================================================
// KeyValue row (للتفاصيل في الـ Drawer والكروت)
// ==================================================================

export function KeyValue({
  label,
  children,
  mono = false,
}: {
  label: string
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-2.5 last:border-0">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span
        dir="auto"
        className={cn(
          'min-w-0 break-all text-right text-sm text-slate-200',
          mono && 'font-mono text-xs',
        )}
      >
        {children ?? '—'}
      </span>
    </div>
  )
}

