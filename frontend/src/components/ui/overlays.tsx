// frontend/src/components/ui/overlays.tsx
// ==================================================================
// Zero Plus - Modal (مركزي) + Drawer (جانبي)
// بيقفل بـ Escape أو الضغط على الخلفية، وبيمنع سكرول الصفحة وهو مفتوح
// ==================================================================

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

import { cn } from '../../utils/format'
import { TONE_ICON, type IconType, type Tone } from './tones'

// ==================================================================
// Shared behavior
// ==================================================================

function useOverlayBehavior(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
}

// ==================================================================
// Modal (مركزي)
// ==================================================================

export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  tone = 'cyan',
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  icon?: IconType
  tone?: Tone
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useOverlayBehavior(open, onClose)
  if (!open) return null

  return (
    <div
      dir="ltr"
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="zp-anim-fade-in absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog – flex column + max-height عشان المحتوى والأزرار يبانوا */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'zp-anim-scale-in relative flex w-full flex-col',
          'max-h-[90vh]',
          'overflow-hidden rounded-2xl border border-white/10 bg-[#0b1224]',
          'shadow-2xl shadow-black/60',
          width,
        )}
      >
        {/* Top accent line */}
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />

        {/* ---------- Header (ثابت) ---------- */}
        <div className="flex shrink-0 items-start gap-3 border-b border-white/6 px-6 py-5">
          {Icon && (
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                TONE_ICON[tone],
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {description && (
              <p dir="auto" className="mt-1 text-sm text-slate-400">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ---------- Body (قابل للتمرير) ---------- */}
        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-4">{children}</div>
          </div>
        )}

        {/* ---------- Footer (ثابت تحت) ---------- */}
        {footer && (
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-white/6 bg-black/20 px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ==================================================================
// Drawer (جانبي)
// ==================================================================

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  useOverlayBehavior(open, onClose)
  if (!open) return null

  return (
    <div dir="ltr" className="fixed inset-0 z-60">
      {/* Backdrop */}
      <div
        className="zp-anim-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="zp-anim-drawer absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-[#070b14] shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/6 px-6 py-5">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-white">{title}</h3>
            {subtitle && (
              <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </aside>
    </div>
  )
}