// frontend/src/pages/policies/blocks.tsx — Section و ToggleRow

import { type ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { Card, Toggle } from '../../components/ui/kit'


// ==================================================================
// Small building blocks
// ==================================================================

export function Section({
  icon: Icon,
  title,
  description,
  delay,
  children,
}: {
  icon: typeof Gauge
  title: string
  description: string
  delay: number
  children: ReactNode
}) {
  return (
    <Card delay={delay} className="p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </Card>
  )
}

/** صف إعداد Boolean: عنوان + شرح + Toggle */
export function ToggleRow({
  label,
  hint,
  checked,
  modified,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  modified: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-xl border border-white/6 bg-white/2 px-4 py-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-white">
          {label}
          {modified && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Changed" />}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}
