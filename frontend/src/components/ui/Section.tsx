// frontend/src/components/ui/Section.tsx
// Shared Section component — exact design language from PoliciesPage
// Used across all dashboard pages for visual consistency.

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from './kit'

export function Section({
  icon: Icon,
  title,
  description,
  delay = 0,
  children,
  actions,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  delay?: number
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <Card delay={delay} className={className ?? 'p-6'}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-5">{children}</div>
    </Card>
  )
}

export default Section
