// frontend/src/pages/dashboard/TopPanel.tsx
// ==================================================================
// أعلى المصادر/المسارات من GET /dashboard/top?by=...&limit=10
// Tabs: ip | path | country | asn | ipType | stage
// كل صف: القيمة + شريط نسبي (total) مقسّم blocked/challenged + متوسط الخطورة
// ==================================================================

import { ListOrdered } from 'lucide-react'

import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/kit'
import type { TopBy, TopData } from '../../services/dashboardService'
import { cn, formatNumber } from '../../utils/format'
import type { Section } from './useDashboardData'

const TABS: Array<{ by: TopBy; label: string }> = [
  { by: 'ip', label: 'IPs' },
  { by: 'path', label: 'Paths' },
  { by: 'country', label: 'Countries' },
  { by: 'asn', label: 'ASN' },
  { by: 'ipType', label: 'IP type' },
  { by: 'stage', label: 'Stage' },
]

function riskColor(score: number): string {
  if (score >= 80) return 'text-rose-300'
  if (score >= 60) return 'text-orange-300'
  if (score >= 31) return 'text-amber-300'
  return 'text-emerald-300'
}

export default function TopPanel({
  section,
  by,
  onBy,
  onRetry,
}: {
  section: Section<TopData>
  by: TopBy
  onBy: (by: TopBy) => void
  onRetry: () => void
}) {
  const items = section.data?.items ?? []
  const max = Math.max(1, ...items.map((i) => i.total))

  return (
    <Card className="p-5" delay={150}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Top sources</h3>
        <div className="flex flex-wrap gap-1 rounded-xl border border-white/8 bg-white/3 p-1">
          {TABS.map((t) => (
            <button
              key={t.by}
              type="button"
              onClick={() => onBy(t.by)}
              className={cn(
                'rounded-lg px-3 py-1 text-xs font-medium',
                by === t.by ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:text-white',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {section.loading && !section.data ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : section.error && !section.data ? (
        <ErrorState message={section.error} onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyState icon={ListOrdered} title="Nothing to rank yet" description="No requests matched this range." />
      ) : (
        <ul className={cn('space-y-3 transition-opacity', section.loading && 'opacity-60')}>
          {items.map((item, i) => {
            const width = (item.total / max) * 100
            const blockedW = item.total ? (item.blocked / item.total) * width : 0
            const challengedW = item.total ? (item.challenged / item.total) * width : 0
            return (
              <li key={`${item.value}-${i}`} style={{ animationDelay: `${i * 40}ms` }} className="zp-anim-fade-up">
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-mono text-slate-200" title={item.label ?? item.value}>
                    <span className="mr-2 text-xs text-slate-600">{i + 1}</span>
                    {item.label || item.value}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    <span className="text-slate-400">{formatNumber(item.total)} req</span>
                    <span className={cn('tabular-nums', riskColor(item.avgRiskScore))}>risk {item.avgRiskScore.toFixed(0)}</span>
                  </span>
                </div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-white/6">
                  <div className="zp-anim-bar absolute inset-y-0 left-0 rounded-full bg-cyan-400/60" style={{ width: `${width}%` }} />
                  <div className="zp-anim-bar absolute inset-y-0 left-0 rounded-full bg-indigo-400" style={{ width: `${blockedW + challengedW}%` }} />
                  <div className="zp-anim-bar absolute inset-y-0 left-0 rounded-full bg-rose-500" style={{ width: `${blockedW}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-slate-600">
                  {formatNumber(item.blocked)} blocked · {formatNumber(item.challenged)} challenged
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
