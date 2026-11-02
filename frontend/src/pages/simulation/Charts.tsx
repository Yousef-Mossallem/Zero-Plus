// frontend/src/pages/simulation/Charts.tsx
// ==================================================================
// Timeline Chart (Stacked Area كل 5 ثواني) + Donut Chart لتوزيع القرارات
// ==================================================================

import { BarChart3, PieChart as PieIcon } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Card, EmptyState, Skeleton } from '../../components/ui/kit'
import type { RunTotals } from '../../services/simulationsService'
import { formatNumber } from '../../utils/format'
import { BUCKET_MS, type TimelineResult } from './shared'

const EMPTY_MESSAGE = 'ابدأ المحاكاة لعرض النتائج.'

const DECISIONS = [
  { key: 'allowed', label: 'Allowed', color: '#34d399' },
  { key: 'challenged', label: 'Challenged', color: '#818cf8' },
  { key: 'rateLimited', label: 'Rate limited', color: '#fbbf24' },
  { key: 'blocked', label: 'Blocked', color: '#fb7185' },
] as const

const TOOLTIP_STYLE = {
  background: '#0b1224',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  fontSize: 12,
}

// ------------------------------------------------------------------
// Timeline
// ------------------------------------------------------------------

export function TimelineChart({ timeline, loading }: { timeline: TimelineResult; loading: boolean }) {
  const subtitle =
    timeline.source === 'live'
      ? `Grouped every ${BUCKET_MS / 1000} seconds from live counters`
      : timeline.source === 'events'
        ? `Grouped every ${BUCKET_MS / 1000} seconds from the latest loaded events`
        : `Grouped every ${BUCKET_MS / 1000} seconds`

  return (
    <Card className="p-5 lg:col-span-2" delay={100}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Decisions over time</h3>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {DECISIONS.map((d) => (
            <span key={d.key} className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
              {d.label}
            </span>
          ))}
        </div>
      </div>

      {loading && timeline.points.length === 0 ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : timeline.points.length === 0 ? (
        <EmptyState icon={BarChart3} title={EMPTY_MESSAGE} />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline.points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                {DECISIONS.map((d) => (
                  <linearGradient key={d.key} id={`zp-sim-${d.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={d.color} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={d.color} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#94a3b8' }} labelFormatter={(v) => `t + ${String(v)}`} />
              {DECISIONS.map((d) => (
                <Area
                  key={d.key}
                  type="monotone"
                  stackId="decisions"
                  dataKey={d.key}
                  name={d.label}
                  stroke={d.color}
                  strokeWidth={2}
                  fill={`url(#zp-sim-${d.key})`}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------
// Donut
// ------------------------------------------------------------------

export function DecisionDonut({
  totals,
  loading,
}: {
  totals: Partial<RunTotals> | null
  loading: boolean
}) {
  const data = DECISIONS.map((d) => ({ ...d, value: totals?.[d.key] ?? 0 }))
  const sum = data.reduce((acc, d) => acc + d.value, 0)

  return (
    <Card className="p-5" delay={140}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-white">Decision distribution</h3>
        <p className="text-xs text-slate-500">Protection decisions during the run</p>
      </div>

      {loading && sum === 0 ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : sum === 0 ? (
        <EmptyState icon={PieIcon} title={EMPTY_MESSAGE} />
      ) : (
        <>
          <div className="relative h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="62%"
                  outerRadius="88%"
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {data.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums text-white">{formatNumber(sum)}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Decisions</span>
            </div>
          </div>

          <ul className="mt-3 space-y-1.5">
            {data.map((d) => (
              <li key={d.key} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.label}
                </span>
                <span className="tabular-nums text-slate-300">
                  {formatNumber(d.value)} <span className="text-slate-600">· {Math.round((d.value / sum) * 100)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}