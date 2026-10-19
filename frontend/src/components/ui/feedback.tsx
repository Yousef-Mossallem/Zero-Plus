// frontend/src/components/ui/feedback.tsx
// حالات التحميل والفاضي والخطأ + الـ Pagination

import type { ReactNode } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, RefreshCw } from 'lucide-react'

import { cn } from '../../utils/format'
import { Button } from './controls'
import type { IconType } from './tones'

// ==================================================================
// Skeleton / Empty / Error states
// ==================================================================

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('zp-skeleton rounded-md', className)} />
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: IconType
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="zp-anim-fade-in flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/4 text-slate-500 ring-1 ring-white/8">
        <Icon className="h-7 w-7" />
      </div>
      <p className="mt-4 text-base font-semibold text-white">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
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
    <div className="zp-anim-fade-in flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20">
        <AlertCircle className="h-7 w-7" />
      </div>
      <p className="mt-4 text-base font-semibold text-white">Something went wrong</p>
      <p dir="auto" className="mt-1 max-w-md text-sm text-slate-400">
        {message}
      </p>
      {onRetry && (
        <Button className="mt-5" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

// ==================================================================
// Pagination
// ==================================================================

export function PaginationBar({
  page,
  totalPages,
  total,
  limit,
  onPage,
  onLimit,
  disabled = false,
}: {
  page: number
  totalPages: number
  total: number
  limit: number
  onPage: (page: number) => void
  onLimit?: (limit: number) => void
  disabled?: boolean
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-white/6 px-5 py-3.5 sm:flex-row">
      <p className="text-xs text-slate-500">
        Showing <span className="text-slate-300">{from}–{to}</span> of{' '}
        <span className="text-slate-300">{total.toLocaleString('en-US')}</span>
      </p>

      <div className="flex items-center gap-3">
        {onLimit && (
          <select
            value={limit}
            disabled={disabled}
            onChange={(e) => onLimit(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-white/3 px-2 py-1 text-xs text-slate-300 outline-none"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n} className="bg-[#0b1224]">
                {n} / page
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled || page <= 1}
            onClick={() => onPage(page - 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-20 text-center text-xs text-slate-400">
            Page <span className="text-white">{page}</span> / {Math.max(1, totalPages)}
          </span>
          <button
            type="button"
            disabled={disabled || page >= totalPages}
            onClick={() => onPage(page + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

