// frontend/src/pages/dashboard/ThreatMap.tsx
// ==================================================================
// توزيع التهديدات حسب الدولة من GET /dashboard/threat-map
// (مفيش مكتبة خرائط في المشروع، فبنعرض شبكة دول ملوّنة حسب threatLevel)
// threatLevel: low | medium | high | critical • blockRate = blocked / total
// unknownCountryTotal بيتعرض منفصل
// ==================================================================

import { Globe2 } from 'lucide-react'

import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/kit'
import type { ThreatCountry, ThreatLevel, ThreatMapData } from '../../services/dashboardService'
import { cn, formatNumber } from '../../utils/format'
import type { Section } from './useDashboardData'

const LEVEL: Record<ThreatLevel, { label: string; tile: string; dot: string }> = {
  critical: { label: 'Critical', tile: 'border-rose-500/40 bg-rose-500/12', dot: 'bg-rose-500' },
  high: { label: 'High', tile: 'border-orange-400/35 bg-orange-400/10', dot: 'bg-orange-400' },
  medium: { label: 'Medium', tile: 'border-amber-300/30 bg-amber-300/8', dot: 'bg-amber-300' },
  low: { label: 'Low', tile: 'border-emerald-400/25 bg-emerald-400/6', dot: 'bg-emerald-400' },
}

const ORDER: ThreatLevel[] = ['critical', 'high', 'medium', 'low']

/** اسم الدولة من كودها (Intl مدمج في المتصفح، مفيش مكتبة) */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

function Tile({ c, i }: { c: ThreatCountry; i: number }) {
  const l = LEVEL[c.threatLevel] ?? LEVEL.low
  return (
    <div
      style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}
      title={`${countryName(c.code)} — ${formatNumber(c.total)} requests, ${(c.blockRate * 100).toFixed(1)}% blocked`}
      className={cn('zp-anim-scale-in rounded-xl border p-3', l.tile)}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-bold text-white">{c.code}</span>
        <span className={cn('h-2 w-2 rounded-full', l.dot)} />
      </div>
      <p className="mt-1 truncate text-[11px] text-slate-400">{countryName(c.code)}</p>
      <p className="mt-1.5 text-xs font-semibold tabular-nums text-white">{formatNumber(c.total)}</p>
      <p className="text-[11px] text-slate-500">{(c.blockRate * 100).toFixed(0)}% blocked</p>
    </div>
  )
}

export default function ThreatMap({
  section,
  onRetry,
}: {
  section: Section<ThreatMapData>
  onRetry: () => void
}) {
  const countries = section.data?.countries ?? []
  const sorted = [...countries].sort(
    (a, b) => ORDER.indexOf(a.threatLevel) - ORDER.indexOf(b.threatLevel) || b.total - a.total,
  )

  return (
    <Card className="p-5" delay={250}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Threat map</h3>
          <p className="text-xs text-slate-500">Requests by country · all servers</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className={cn('h-2 w-2 rounded-full', LEVEL[k].dot)} />
              {LEVEL[k].label}
            </span>
          ))}
        </div>
      </div>

      {section.loading && !section.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : section.error && !section.data ? (
        <ErrorState message={section.error} onRetry={onRetry} />
      ) : sorted.length === 0 ? (
        <EmptyState icon={Globe2} title="No geographic data" description="Country data appears once traffic with a resolved location arrives." />
      ) : (
        <>
          <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6', section.loading && 'opacity-60')}>
            {sorted.map((c, i) => (
              <Tile key={c.code} c={c} i={i} />
            ))}
          </div>
          {(section.data?.unknownCountryTotal ?? 0) > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              {formatNumber(section.data?.unknownCountryTotal)} requests came from an unresolved location.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
