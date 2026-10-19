// frontend/src/components/ui/controls.tsx
// الأزرار وحقول الإدخال

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { Loader2 } from 'lucide-react'

import { cn } from '../../utils/format'
import type { IconType } from './tones'

// ==================================================================
// Button
// ==================================================================

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'success'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-linear-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-blue-500',
  outline: 'border border-white/10 bg-white/3 text-slate-200 hover:border-white/20 hover:bg-white/6',
  ghost: 'text-slate-400 hover:bg-white/5 hover:text-white',
  danger:
    'border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 hover:text-rose-200',
  success:
    'border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
}

export function Button({
  variant = 'outline',
  size = 'md',
  loading = false,
  icon: Icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: IconType
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium active:scale-[0.97]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
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

// ==================================================================
// Form controls
// ==================================================================

const CONTROL_BASE =
  'w-full rounded-xl border bg-white/3 text-sm text-white placeholder:text-slate-600 outline-none ' +
  'focus:border-cyan-500/50 focus:bg-white/5 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-50'

function controlBorder(hasError: boolean) {
  return hasError ? 'border-rose-500/50' : 'border-white/10 hover:border-white/20'
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string | undefined
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </label>
      {children}
      {error ? (
        <p dir="auto" className="text-xs text-rose-400">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-slate-600">{hint}</p>
      )}
    </div>
  )
}

export function TextInput({
  icon: Icon,
  invalid = false,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { icon?: IconType; invalid?: boolean }) {
  return (
    <div className="relative">
      {Icon && (
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      )}
      <input
        className={cn(
          CONTROL_BASE,
          controlBorder(invalid),
          'py-2.5 pr-4',
          Icon ? 'pl-10' : 'pl-4',
          className,
        )}
        {...rest}
      />
    </div>
  )
}

export function SelectInput({
  invalid = false,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(CONTROL_BASE, controlBorder(invalid), 'cursor-pointer px-3.5 py-2.5', className)}
      {...rest}
    >
      {children}
    </select>
  )
}

export function TextArea({
  invalid = false,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(CONTROL_BASE, controlBorder(invalid), 'resize-none px-4 py-2.5', className)}
      {...rest}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-cyan-400/40 bg-cyan-500/30' : 'border-white/10 bg-white/5',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all duration-200',
          checked ? 'left-5.5 bg-cyan-300' : 'left-0.5 bg-slate-500',
        )}
      />
    </button>
  )
}

