// frontend/src/pages/dashboard/OverviewSection.tsx
// ==================================================================
// قسم الملخص: تنبيه Surge + كروت الترافيك + كروت "الوضع الأمني"
// من GET /dashboard/overview (كل الأرقام جاية من الباك إند)
// ==================================================================

import { Activity, AlertTriangle, Ban, CheckCircle2, Gauge, ShieldCheck, Timer, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Card, Skeleton, StatCard } from '../../components/ui/kit'
import type { OverviewData } from '../../services/dashboardService'
import { cn, formatNumber } from '../../utils/format'
import type { Section } from './useDashboardData'

/** نسبة مئوية بدون كسور زيادة */
function pct(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%'
}

const SERVER_DOTS: Array<[keyof OverviewData['servers'], string, string]> = [
  ['ONLINE', 'Online', 'bg-emerald-400'],
  ['DEGRADED', 'Degraded', 'bg-amber-400'],
  ['OFFLINE', 'Offline', 'bg-rose-500'],
  ['PENDING', 'Pending', 'bg-slate-500'],
  ['MAINTENANCE', 'Maintenance', 'bg-indigo-400'],
]

function Row({ label, value, tone = 'text-white' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2.5 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
      <span className={cn('text-sm font-semibold tabular-nums', tone)}>{value}</span>
    </div>
  )
}

/** تنبيه ارتفاع غير طبيعي في الترافيك (risk.surgeDetected) */
export function SurgeBanner({ data }: { data: OverviewData | null }) {
  if (!data?.risk.surgeDetected) return null
  return (
    <div className="zp-anim-fade-up flex items-center gap-4 rounded-2xl border border-amber-400/30 bg-amber-500/8 px-5 py-4">
      <span className="zp-anim-pulse-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-amber-100">Traffic surge detected</p>
        <p className="text-xs text-amber-200/70">
          {data.risk.surgeCount.toLocaleString('en-US')} surge signal{data.risk.surgeCount === 1 ? '' : 's'} in{' '}
          {data.rangeLabel}. Review the timeline and consider tightening your policies.
        </p>
      </div>
    </div>
  )
}

export default function OverviewSection({ section }: { section: Section<OverviewData> }) {
  const { data, loading } = section
  const first = loading && !data
  const t = data?.traffic

  return (
    <>
      {/* ---------- كروت الترافيك ---------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total requests" value={formatNumber(t?.total)} icon={Activity} tone="cyan" loading={first} delay={0} />
        <StatCard label="Allowed" value={formatNumber(t?.allowed)} icon={CheckCircle2} tone="emerald" loading={first} delay={50}
          hint={t ? pct(t.allowed, t.total) : undefined} />
        <StatCard label="Blocked" value={formatNumber(t?.blocked)} icon={Ban} tone="rose" loading={first} delay={100}
          hint={t ? pct(t.blocked, t.total) : undefined} />
        <StatCard label="Challenged" value={formatNumber(t?.challenged)} icon={ShieldCheck} tone="indigo" loading={first} delay={150}
          hint={t ? pct(t.challenged, t.total) : undefined} />
        <StatCard label="Rate limited" value={formatNumber(t?.rateLimited)} icon={Timer} tone="amber" loading={first} delay={200}
          hint={t ? `${formatNumber(t.monitored)} monitored` : undefined} />
        <StatCard label="Avg risk score" value={data ? data.risk.avgScore.toFixed(1) : '—'} icon={Gauge} tone="orange" loading={first} delay={250}
          hint="Out of 100" />
      </div>

      {/* ---------- الوضع الأمني ---------- */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5" delay={150}>
          <h3 className="mb-1 text-sm font-semibold text-white">Servers</h3>
          {first ? (
            <Skeleton className="mt-3 h-24 w-full" />
          ) : (
            <div className="mt-2 space-y-2.5">
              {SERVER_DOTS.map(([key, label, dot]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-400">
                    <span className={cn('h-2 w-2 rounded-full', dot)} />
                    {label}
                  </span>
                  <span className="font-semibold tabular-nums text-white">{data?.servers[key] ?? 0}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5" delay={200}>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4 text-cyan-400" /> Reputation
          </h3>
          {first ? (
            <Skeleton className="mt-3 h-24 w-full" />
          ) : (
            <>
              <Row label="Active bans" value={formatNumber(data?.reputation.activeBans)} tone="text-rose-300" />
              <Row label="Permanent" value={formatNumber(data?.reputation.permanentBans)} />
              <Row label="Critical entries" value={formatNumber(data?.reputation.criticalEntries)} tone="text-amber-300" />
              <Row label="New bans (range)" value={formatNumber(data?.reputation.newBansInRange)} />
            </>
          )}
        </Card>

        <Card className="p-5" delay={250}>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-indigo-400" /> Challenges
          </h3>
          {first || !data ? (
            <Skeleton className="mt-3 h-24 w-full" />
          ) : (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className="zp-anim-bar h-full rounded-full bg-emerald-400"
                  style={{ width: `${data.challenges.total ? (data.challenges.passed / data.challenges.total) * 100 : 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{pct(data.challenges.passed, data.challenges.total)} pass rate</p>
              <Row label="Total" value={formatNumber(data.challenges.total)} />
              <Row label="Passed" value={formatNumber(data.challenges.passed)} tone="text-emerald-300" />
              <Row label="Failed" value={formatNumber(data.challenges.failed)} tone="text-rose-300" />
              {data.unreadNotifications > 0 && (
                <Link to="/notifications" className="mt-2 block text-xs text-cyan-400 hover:text-cyan-300">
                  {data.unreadNotifications} unread notification{data.unreadNotifications === 1 ? '' : 's'} →
                </Link>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  )
}
