// frontend/src/pages/dashboard/TimelineChart.tsx
// ==================================================================
// الرسم الزمني (Area Chart) من GET /dashboard/timeline → data.points
//  - محور X = time (التجميع بيحدده الباك: 5 دقايق / ساعة / يوم)
//  - السلاسل: total / blocked / challenged / rateLimited / allowed (قابلة للإخفاء)
// ==================================================================

import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/kit'
import type { DashboardRange, TimelineData } from '../../services/dashboardService'
import { cn } from '../../utils/format'
import type { Section } from './useDashboardData'

type SeriesKey = 'total' | 'blocked' | 'challenged' | 'rateLimited' | 'allowed'

const SERIES_CONFIG: Array<{ key: SeriesKey; color: string }> = [
  { key: 'total', color: '#22d3ee' },
  { key: 'allowed', color: '#34d399' },
  { key: 'blocked', color: '#fb7185' },
  { key: 'challenged', color: '#818cf8' },
  { key: 'rateLimited', color: '#fbbf24' },
]

/** 1h / 24h = ساعة:دقيقة • 7d / 30d = يوم وشهر */
function formatTick(iso: string, range: DashboardRange): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return range === '1h' || range === '24h'
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export default function TimelineChart({
  section,
  range,
  onRetry,
}: {
  section: Section<TimelineData>
  range: DashboardRange
  onRetry: () => void
}) {
  const { t } = useTranslation('dashboard')
  const [active, setActive] = useState<Record<SeriesKey, boolean>>({
    total: true,
    allowed: false,
    blocked: true,
    challenged: true,
    rateLimited: false,
  })

  const series = useMemo(
    () =>
      SERIES_CONFIG.map((s) => ({
        ...s,
        label: t(`timeline.series.${s.key}` as never),
      })),
    [t],
  )

  const points = section.data?.points ?? []
  const hasData = useMemo(() => points.some((p) => p.total > 0), [points])

  return (
    <Card className="p-5" delay={100}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{t('timeline.title')}</h3>
          <p className="text-xs text-slate-500">
            {section.data ? `Grouped every ${section.data.interval}` : 'Requests per interval'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {series.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive((a) => ({ ...a, [s.key]: !a[s.key] }))}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs',
                active[s.key] ? 'border-white/15 bg-white/6 text-white' : 'border-white/6 text-slate-500 hover:text-slate-300',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: active[s.key] ? s.color : '#475569' }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {section.loading && !section.data ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : section.error && !section.data ? (
        <ErrorState message={section.error} onRetry={onRetry} />
      ) : !hasData ? (
        <EmptyState icon={BarChart3} title={t('timeline.noData')} description="" />
      ) : (
        <div className={cn('h-72 w-full transition-opacity', section.loading && 'opacity-60')}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`zp-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={(v: string) => formatTick(v, range)}
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#0b1224', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
                labelFormatter={(v) => new Date(String(v)).toLocaleString('en-GB')}
              />
              {series.filter((s) => active[s.key]).map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#zp-grad-${s.key})`}
                  isAnimationActive
                  animationDuration={700}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
