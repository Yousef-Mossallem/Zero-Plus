// frontend/src/components/ui/kit.tsx
// ==================================================================
// Zero Plus - مكتبة المكandنات الأساسية (نقطة تصدير andاحدة شاملة)
// ==================================================================

import React from 'react'
import Navbar from '../Navbar'
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
  type LucideIcon as LucideIconType,
} from 'lucide-react'
import { cn } from '../../utils/format'

// ==================================================================
// Types
// ==================================================================

export type Tone = 'emerald' | 'rose' | 'amber' | 'indigo' | 'cyan' | 'purple' | 'slate' | 'blue' | 'orange'
export type IconType = LucideIconType
export type LucideIcon = LucideIconType


/** Lucide/forwardRef icons are objects ({$$typeof, render}), not plain functions */
function renderIcon(
  Icon: IconType | React.ReactNode | undefined,
  className: string,
): React.ReactNode {
  if (!Icon) return null
  if (React.isValidElement(Icon)) return Icon
  if (typeof Icon === 'function' || (typeof Icon === 'object' && Icon !== null)) {
    return React.createElement(Icon as React.ElementType, { className })
  }
  return null
}


// ==================================================================
// Layout
// ==================================================================

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div dir="ltr" className="relative flex min-h-screen w-full bg-[#05070f] text-white">
      <div className="zp-ambient-glow" />
      <Navbar />
      <main className="min-w-0 flex-1 px-4 pb-14 pt-20 sm:px-6 lg:px-8 lg:pt-8">
        <div className="zp-anim-page-in mx-auto w-full max-w-7xl space-y-7" dir="ltr">
          {children}
        </div>
      </main>
    </div>
  )
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: IconType
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="zp-anim-fade-up mb-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-cyan-400/25 to-blue-600/25 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.15)] ring-1 ring-cyan-400/25">
          <div className="absolute inset-0 rounded-2xl bg-cyan-400/10 blur-md" />
          <Icon className="relative h-6 w-6" />
        </div>
        <div>
          <h1 className="bg-linear-to-r from-white via-white to-slate-300 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 zp-anim-fade-up" style={{ animationDelay: '80ms' }}>
          {actions}
        </div>
      )}
    </div>
  )
}

export function Card({
  children,
  className,
  delay = 0,
  accent = false,
  onClick,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  accent?: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'zp-anim-stagger zp-glass-card rounded-2xl p-6',
        accent ? 'border-amber-400/25 bg-amber-500/5' : undefined,
        onClick ? 'cursor-pointer' : undefined,
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

// ==================================================================
// Controls
// ==================================================================

export function Button({
  variant = 'primary',
  icon: Icon,
  loading,
  className,
  children,
  size = 'md',
  ...props
}: {
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'secondary'
  icon?: IconType
  loading?: boolean
  className?: string
  children?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<string, string> = {
    primary: 'bg-linear-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-sky-400 hover:shadow-cyan-400/30 hover:-translate-y-0.5 disabled:from-cyan-500/50 disabled:to-sky-500/50 disabled:shadow-none disabled:translate-y-0',
    ghost: 'bg-transparent text-slate-300 hover:bg-white/5 hover:text-white',
    danger: 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20',
    outline: 'border border-white/10 bg-transparent text-slate-300 hover:bg-white/5 hover:text-white hover:border-white/20',
    secondary: 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-white/5',
  }

  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  }

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant] || variants.primary,
        sizes[size] || sizes.md,
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        Icon && <Icon className="h-4 w-4" />
      )}
      {children}
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 cursor-pointer select-none',
        disabled ? 'opacity-50 cursor-not-allowed' : undefined,
        className,
      )}
    >
      <div
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative flex h-6 w-11 items-center rounded-full p-1 transition-colors duration-200 ease-in-out',
          checked ? 'bg-cyan-500 justify-end' : 'bg-slate-800 border border-white/10 justify-start',
        )}
      >
        <span className="h-4 w-4 rounded-full bg-white shadow-md transition-transform duration-200" />
      </div>
      {label && <span className="text-sm font-medium text-slate-300">{label}</span>}
    </label>
  )
}

export function TextInput({
  className,
  invalid,
  icon: Icon,
  ...props
}: {
  className?: string
  invalid?: boolean
  icon?: IconType | React.ReactNode
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      {Icon ? (
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 flex items-center justify-center pointer-events-none">
          {renderIcon(Icon, 'h-4 w-4')}
        </div>
      ) : null}
      <input
        className={cn(
          'w-full rounded-lg border bg-slate-950/50 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none transition-colors focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20',
          invalid ? 'border-rose-500/50 focus:border-rose-500 focus:ring-rose-500/20' : 'border-white/10',
          Icon ? 'pr-10' : undefined,
          className,
        )}
        {...props}
      />
    </div>
  )
}


export function TextArea({
  className,
  invalid,
  ...props
}: {
  className?: string
  invalid?: boolean
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full min-h-[96px] rounded-lg border bg-slate-950/50 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none transition-colors focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 resize-y',
        invalid ? 'border-rose-500/50 focus:border-rose-500 focus:ring-rose-500/20' : 'border-white/10',
        className,
      )}
      {...props}
    />
  )
}

export function SelectInput({
  className,
  children,
  ...props
}: {
  className?: string
  children: React.ReactNode
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full rounded-lg border border-white/10 bg-slate-950/50 px-3.5 py-2.5 text-sm text-white outline-none transition-colors focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-200">{label}</label>
      {children}
      {(hint || error) && (
        <p className={cn('text-xs', error ? 'text-rose-400' : 'text-slate-500')}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

// ==================================================================
// Feedback & Display
// ==================================================================

export function StatCard({
  label,
  title,
  value,
  icon: Icon,
  tone = 'emerald',
  loading,
  delay = 0,
  hint,
  className,
  children,
}: {
  label?: string
  title?: string
  value?: React.ReactNode
  icon?: IconType | React.ReactNode
  tone?: Tone
  loading?: boolean
  delay?: number
  hint?: string
  className?: string
  children?: React.ReactNode
}) {
  const tones: Record<Tone, string> = {
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  }

  const headerText = label || title || ''

  return (
    <div
      className={cn('zp-anim-fade-up rounded-2xl border p-5', tones[tone] || tones.emerald, className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between">
        <div>
          {headerText ? (
            <p className="text-xs font-medium uppercase tracking-wider opacity-80">
              {headerText}
            </p>
          ) : null}
          {loading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded bg-white/10" />
          ) : (
            value !== undefined && <p className="mt-2 text-3xl font-bold text-white">{value}</p>
          )}
          {hint && <p className="mt-1 text-xs opacity-70">{hint}</p>}
          {children}
        </div>
        {Icon ? (
          <div className="rounded-xl bg-white/5 p-3 flex items-center justify-center">
            {renderIcon(Icon, 'h-6 w-6')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const StatBox = StatCard

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-white/5', className)} />
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: IconType
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="rounded-full bg-white/5 p-4">
        <Icon className="h-8 w-8 text-slate-500" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <AlertCircle className="h-10 w-10 text-rose-400" />
      <p className="text-sm text-slate-300">{message}</p>
      {onRetry && (
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function Badge({
  children,
  tone,
  variant,
  dot = false,
  className,
}: {
  children?: React.ReactNode
  tone?: Tone
  variant?: Tone | string
  dot?: boolean
  className?: string
}) {
  const activeTone = (tone || variant || 'cyan') as Tone

  const tones: Record<Tone, string> = {
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[activeTone] || tones.cyan,
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

// ==================================================================
// DecisionBadge Component
// ==================================================================

export function DecisionBadge({ decision, className }: { decision?: string; className?: string }) {
  const d = (decision || '').toUpperCase()
  let tone: Tone = 'slate'

  switch (d) {
    case 'ALLOW':
      tone = 'emerald'
      break
    case 'BLOCK':
      tone = 'rose'
      break
    case 'CHALLENGE':
      tone = 'indigo'
      break
    case 'RATE_LIMIT':
      tone = 'amber'
      break
    case 'MONITOR':
      tone = 'cyan'
      break
    default:
      tone = 'slate'
  }

  return (
    <Badge tone={tone} className={className}>
      {d || 'UNKNOWN'}
    </Badge>
  )
}

export function KeyValue({
  label,
  value,
  children,
  mono = false,
  hint,
  className,
}: {
  label: string
  value?: React.ReactNode
  children?: React.ReactNode
  mono?: boolean
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between py-2 border-b border-white/5 last:border-0', className)}>
      <div>
        <span className="text-sm text-slate-400">{label}</span>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div className={cn('text-sm font-medium text-white', mono ? 'font-mono' : undefined)}>
        {children !== undefined ? children : value}
      </div>
    </div>
  )
}

// ==================================================================
// Navigation & Overlays
// ==================================================================

export function PaginationBar({
  page,
  currentPage,
  totalPages,
  total = 0,
  limit = 10,
  disabled,
  onPage,
  onPageChange,
  onLimit,
}: {
  page?: number
  currentPage?: number
  totalPages: number
  total?: number
  limit?: number
  disabled?: boolean
  onPage?: (page: number) => void
  onPageChange?: (page: number) => void
  onLimit?: (limit: number) => void
}) {
  const activePage = page ?? currentPage ?? 1
  const changePage = onPage || onPageChange || (() => {})

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-2 py-3">
      <div className="flex items-center gap-3">
        <p className="text-xs text-slate-400">
          Showing {Math.min((activePage - 1) * limit + 1, total)}–{Math.min(activePage * limit, total)} of {total}
        </p>
        {onLimit && (
          <select
            value={limit}
            onChange={(e) => onLimit(Number(e.target.value))}
            className="rounded border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-300 outline-none"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          disabled={activePage <= 1 || disabled}
          onClick={() => changePage(activePage - 1)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 disabled:opacity-30"
          type="button"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-white">
          {activePage} / {totalPages || 1}
        </span>
        <button
          disabled={activePage >= totalPages || disabled}
          onClick={() => changePage(activePage + 1)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 disabled:opacity-30"
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  tone = 'amber',
  footer,
  children,
}: {
  open: boolean
  onClose?: () => void
  title: string
  description?: string
  icon?: IconType
  tone?: Tone
  footer?: React.ReactNode
  children?: React.ReactNode
}) {
  if (!open) return null

  const tones: Record<Tone, string> = {
    cyan: 'bg-cyan-500/10 text-cyan-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    rose: 'bg-rose-500/10 text-rose-400',
    amber: 'bg-amber-500/10 text-amber-400',
    indigo: 'bg-indigo-500/10 text-indigo-400',
    purple: 'bg-purple-500/10 text-purple-400',
    slate: 'bg-slate-500/10 text-slate-400',
    blue: 'bg-blue-500/10 text-blue-400',
    orange: 'bg-orange-500/10 text-orange-400',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {Icon && (
          <div className="mb-4 flex items-center gap-3">
            <div className={cn('rounded-lg p-2', tones[tone] || tones.amber)}>
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-white pr-8">{title}</h3>
          </div>
        )}
        {!Icon && <h3 className="mb-4 text-lg font-semibold text-white">{title}</h3>}
        {description && <p className="mb-6 text-sm text-slate-400">{description}</p>}
        {children && <div className="mb-6">{children}</div>}
        {footer && <div className="flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  )
}

// ==================================================================
// Re-exports
// ==================================================================

export { ChevronLeft, ChevronRight }

// Re-export Drawer from overlays (used by EventDrawer, etc.)
export { Drawer } from './overlays'