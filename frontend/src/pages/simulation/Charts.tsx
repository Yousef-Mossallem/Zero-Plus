// frontend/src/pages/simulation/Charts.tsx
// ==================================================================
// Timeline Chart (Stacked Area every 5 seconds) + Donut Chart for decision distribution
// ==================================================================

import { BarChart3, PieChart as PieIcon } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, EmptyState, Skeleton } from '../../components/ui/kit'
import type { RunTotals } from '../../services/simulationsService'
import { formatNumber } from '../../utils/format'
import { BUCKET_MS, type TimelineResult } from './shared'

const EMPTY_MESSAGE = 'Start the simulation to see results.'

const DECISIONS = [
  { key: 'allowed', label: 'Allowed', color: '#34d399' },
  { key: 'challenged', label: 'Challenged', color: '#818cf8' },
  { key: 'rateLimited', label: 'Rate limited', color: '#fbbf24' },
  { key: 'blocked', label: 'Blocked', color: '#fb7185' },
] as const

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'rgba(11, 18, 36, 0.96)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 12,
  fontSize: 12,
  padding: '10px 12px',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
}

// ------------------------------------------------------------------
// Timeline
// ------------------------------------------------------------------

export function TimelineChart({
  timeline,
  loading,
}: {
  timeline: TimelineResult
  loading: boolean
}) {
  const subtitle =
    timeline.source === 'live'
      ? `Grouped every ${BUCKET_MS / 1000}s from live counters`
      : timeline.source === 'events'
        ? `Grouped every ${BUCKET_MS / 1000}s from the latest loaded events`
        : `Grouped every ${BUCKET_MS / 1000} seconds`

  return (
    <Card className="overflow-hidden p-0 lg:col-span-2" delay={100}>
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-white/6 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
              <BarChart3 className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Decisions over time</h3>
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {DECISIONS.map((d) => (
            <span key={d.key} className="flex items-center gap-1.5 text-xs text-slate-400">
              <span
                className="h-2 w-2 shrink-0 rounded-full ring-2 ring-white/10"
                style={{ backgroundColor: d.color }}
              />
              {d.label}
            </span>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="p-5">
        {loading && timeline.points.length === 0 ? (
          <Skeleton className="h-72 w-full rounded-xl" />
        ) : timeline.points.length === 0 ? (
          <div className="flex h-72 items-center justify-center">
            <EmptyState icon={BarChart3} title={EMPTY_MESSAGE} />
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={timeline.points}
                margin={{ top: 10, right: 12, left: 0, bottom: 4 }}
              >
                <defs>
                  {DECISIONS.map((d) => (
                    <linearGradient
                      key={d.key}
                      id={`zp-sim-${d.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={d.color} stopOpacity={0.55} />
                      <stop offset="55%" stopColor={d.color} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={d.color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>

                <CartesianGrid
                  stroke="rgba(255,255,255,0.06)"
                  vertical={false}
                  strokeDasharray="3 6"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={28}
                  dy={6}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={36}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#cbd5e1', marginBottom: 4 }}
                  itemStyle={{ color: '#e2e8f0', paddingBlock: 2 }}
                  labelFormatter={(v) => `t + ${String(v)}`}
                  cursor={{ stroke: 'rgba(148, 163, 184, 0.35)', strokeWidth: 1 }}
                />

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
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
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
  const data = DECISIONS.map((d) => ({
    ...d,
    value: totals?.[d.key] ?? 0,
  }))
  const sum = data.reduce((acc, d) => acc + d.value, 0)

  return (
    <Card className="overflow-hidden p-0" delay={140}>
      {/* Header */}
      <div className="border-b border-white/6 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
            <PieIcon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-white">Decision distribution</h3>
            <p className="mt-0.5 text-xs text-slate-500">Protection decisions during the run</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-5">
        {loading && sum === 0 ? (
          <Skeleton className="h-72 w-full rounded-xl" />
        ) : sum === 0 ? (
          <div className="flex h-72 items-center justify-center">
            <EmptyState icon={PieIcon} title={EMPTY_MESSAGE} />
          </div>
        ) : (
          <>
            {/* Donut */}
            <div className="relative mx-auto h-52 w-full max-w-65">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="64%"
                    outerRadius="90%"
                    paddingAngle={3}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {data.map((d) => (
                      <Cell
                        key={d.key}
                        fill={d.color}
                        style={{ filter: 'drop-shadow(0 0 6px rgba(0,0,0,0.25))' }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={{ color: '#e2e8f0' }}
                    formatter={(value, name) => [
                      formatNumber(Number(value ?? 0)),
                      String(name),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Center label */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tabular-nums tracking-tight text-white">
                  {formatNumber(sum)}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Decisions
                </span>
              </div>
            </div>

            {/* Breakdown list */}
            <ul className="mt-5 space-y-1">
              {data.map((d) => {
                const pct = sum > 0 ? Math.round((d.value / sum) * 100) : 0
                return (
                  <li
                    key={d.key}
                    className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-white/3"
                  >
                    <span className="flex min-w-0 items-center gap-2.5 text-xs text-slate-400">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/10"
                        style={{ backgroundColor: d.color }}
                      />
                      <span className="truncate">{d.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-slate-300">
                      {formatNumber(d.value)}
                      <span className="ml-1.5 text-slate-600">· {pct}%</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </Card>
  )
}