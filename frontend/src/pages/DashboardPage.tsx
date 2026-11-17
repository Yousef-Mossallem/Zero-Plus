// frontend/src/pages/DashboardPage.tsx
// ==================================================================
// Zero Plus - Dashboard Page (قراءة فقط)
// مربوطة بـ backend/modules/dashboard:
//   overview • timeline • top • servers • threat-map
// الأدوار: OWNER / ADMIN / ANALYST (الـ VIEWER بيرجع 403 فنعرض رسالة صلاحيات)
// التحميل والتحديث (كل 45 ثانية) في hooks: dashboard/useDashboardData.ts
//
// التصميم: كارت رئيسي (إجمالي الطلبات + تركيبة الترافيك + دايرة الخطورة)
//          ثم كروت KPI صغيرة، ثم الرسم الزمني، ثم Top + Servers، ثم الخريطة
// ==================================================================

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ban,
  Fingerprint,
  LayoutDashboard,
  Lock,
  RefreshCw,
  Server as ServerIcon,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  SelectInput,
  Skeleton,
  StatCard,
} from '../components/ui/kit'
import type { DashboardRange, OverviewData, TopBy } from '../services/dashboardService'
import { listServers, type Server } from '../services/serversService'
import { cn, formatNumber } from '../utils/format'
import { SurgeBanner } from './dashboard/OverviewSection'
import ServersPanel from './dashboard/ServersPanel'
import ThreatMap from './dashboard/ThreatMap'
import TimelineChart from './dashboard/TimelineChart'
import TopPanel from './dashboard/TopPanel'
import { useDashboardData, type Section } from './dashboard/useDashboardData'

const RANGES: Array<{ value: DashboardRange; label: string }> = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
]

type SegmentKey = 'allowed' | 'monitored' | 'challenged' | 'rateLimited' | 'blocked'

const SEGMENTS_CONFIG: Array<{ key: SegmentKey; bar: string }> = [
  { key: 'allowed', bar: 'bg-emerald-400' },
  { key: 'monitored', bar: 'bg-cyan-400' },
  { key: 'challenged', bar: 'bg-indigo-400' },
  { key: 'rateLimited', bar: 'bg-amber-400' },
  { key: 'blocked', bar: 'bg-rose-400' },
]

/** نسبة مئوية بدون كسور زيادة */
function pct(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%'
}

// ==================================================================
// دايرة الخطورة (متوسط الـ Risk Score من 0 إلى 100)
// ==================================================================

function RiskRing({ score, loading }: { score: number | null; loading: boolean }) {
  const { t } = useTranslation('dashboard')
  const r = 52
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, score ?? 0))
  const meta =
    v >= 80
      ? { label: t('threatMap.levels.critical'), color: '#fb7185' }
      : v >= 60
        ? { label: t('threatMap.levels.high'), color: '#fb923c' }
        : v >= 31
          ? { label: t('threatMap.levels.medium'), color: '#fbbf24' }
          : { label: t('threatMap.levels.low'), color: '#34d399' }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-36 w-36">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
          {score !== null && !loading && (
            <circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={meta.color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - v / 100)}
              className="transition-all duration-700"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {loading ? (
            <Skeleton className="h-8 w-14" />
          ) : (
            <>
              <span className="text-3xl font-bold tabular-nums text-white">
                {score !== null ? score.toFixed(1) : '—'}
              </span>
              <span className="text-[11px] text-slate-500">{t('overview.outOf')}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('overview.avgRisk')}</p>
        {!loading && score !== null && (
          <p className="mt-0.5 text-sm font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </p>
        )}
      </div>
    </div>
  )
}

// ==================================================================
// الكارت الرئيسي + كروت الـ KPI
// ==================================================================

function Overview({ section, range, onRetry }: { section: Section<OverviewData>; range: DashboardRange; onRetry: () => void }) {
  const { t } = useTranslation('dashboard')
  const { data, loading, error } = section
  const first = loading && !data

  const segments = useMemo(
    () =>
      SEGMENTS_CONFIG.map((s) => ({
        ...s,
        label: t(`overview.segments.${s.key}` as never),
      })),
    [t],
  )

  if (error && !data) {
    return (
      <Card>
        <ErrorState message={error} onRetry={onRetry} />
      </Card>
    )
  }

  const tr = data?.traffic
  const total = tr?.total ?? 0
  const serverTotal = data ? Object.values(data.servers).reduce((n, v) => n + (v ?? 0), 0) : 0
  const online = data?.servers.ONLINE ?? 0
  const passRate = data && data.challenges.total > 0 ? pct(data.challenges.passed, data.challenges.total) : '—'

  return (
    <>
      {/* ---------- الكارت الرئيسي ---------- */}
      <Card accent className="p-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t('overview.totalRequests', { range: data?.rangeLabel ?? range })}
            </p>
            {first ? (
              <Skeleton className="mt-2 h-12 w-48 rounded-md" />
            ) : (
              <p className="mt-1 text-5xl font-bold tracking-tight text-white tabular-nums">{formatNumber(tr?.total)}</p>
            )}

            {/* شريط تركيبة الترافيك */}
            <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-white/6">
              {!first &&
                tr &&
                total > 0 &&
                segments.map((s) => {
                  const value = tr[s.key] ?? 0
                  return value > 0 ? (
                    <div
                      key={s.key}
                      title={`${s.label}: ${formatNumber(value)}`}
                      className={cn('zp-anim-bar h-full', s.bar)}
                      style={{ width: `${(value / total) * 100}%` }}
                    />
                  ) : null
                })}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
              {segments.map((s) => (
                <div key={s.key}>
                  <p className="flex items-center gap-2 text-xs text-slate-400">
                    <span className={cn('h-2 w-2 rounded-full', s.bar)} />
                    {s.label}
                  </p>
                  {first ? (
                    <Skeleton className="mt-1.5 h-5 w-14" />
                  ) : (
                    <p className="mt-1 text-base font-semibold tabular-nums text-white">
                      {formatNumber(tr?.[s.key])}
                      <span className="ms-1.5 text-xs font-normal text-slate-500">{tr ? pct(tr[s.key] ?? 0, total) : ''}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>

            {data && data.unreadNotifications > 0 && (
              <Link
                to="/notifications"
                className="mt-5 inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-500/8 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/15"
              >
                {t('overview.unread', { count: data.unreadNotifications })}
              </Link>
            )}
          </div>

          <div className="flex justify-center lg:border-s lg:border-white/8 lg:ps-8">
            <RiskRing score={data ? data.risk.avgScore : null} loading={first} />
          </div>
        </div>
      </Card>

      {/* ---------- كروت KPI ---------- */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label={t('kpi.activeBans')}
          value={formatNumber(data?.reputation.activeBans)}
          icon={Ban}
          tone="rose"
          loading={first}
          delay={0}
          hint={data ? t('kpi.permanent', { count: formatNumber(data.reputation.permanentBans) }) : undefined}
        />
        <StatCard
          label={t('kpi.criticalEntries')}
          value={formatNumber(data?.reputation.criticalEntries)}
          icon={Fingerprint}
          tone="amber"
          loading={first}
          delay={50}
          hint={data ? t('kpi.newBans', { count: formatNumber(data.reputation.newBansInRange) }) : undefined}
        />
        <StatCard
          label={t('kpi.challengePass')}
          value={passRate}
          icon={ShieldCheck}
          tone="indigo"
          loading={first}
          delay={100}
          hint={
            data
              ? t('kpi.passedOf', {
                  passed: formatNumber(data.challenges.passed),
                  total: formatNumber(data.challenges.total),
                })
              : undefined
          }
        />
        <StatCard
          label={t('kpi.serversOnline')}
          value={data ? `${online}/${serverTotal}` : '—'}
          icon={ServerIcon}
          tone={data && online < serverTotal ? 'amber' : 'emerald'}
          loading={first}
          delay={150}
          hint={
            data
              ? t('kpi.serverHealth', {
                  degraded: data.servers.DEGRADED ?? 0,
                  offline: data.servers.OFFLINE ?? 0,
                })
              : undefined
          }
        />
      </div>
    </>
  )
}

// ==================================================================
// Page
// ==================================================================

export default function DashboardPage() {
  const { t, i18n } = useTranslation('dashboard')
  const [range, setRange] = useState<DashboardRange>('24h')
  const [serverId, setServerId] = useState('')
  const [topBy, setTopBy] = useState<TopBy>('ip')
  const [serverOptions, setServerOptions] = useState<Server[]>([])

  const { overview, timeline, servers, threat, top, forbidden, updatedAt, refresh } = useDashboardData(
    range,
    serverId,
    topBy,
  )

  // قايمة السيرفرات للفلتر (اختيارية: لو فشلت الصفحة تشتغل من غيرها)
  useEffect(() => {
    listServers({ limit: 100, sortBy: 'domain', sortOrder: 'asc' })
      .then((res) => setServerOptions(res.data))
      .catch(() => {})
  }, [])

  const refreshing = overview.loading || timeline.loading

  return (
    <PageShell>
      <PageHeader
        icon={LayoutDashboard}
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          <>
            {/* اختيار الفترة */}
            <div className="flex rounded-xl border border-white/10 bg-white/3 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                    range === r.value ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <SelectInput value={serverId} onChange={(e) => setServerId(e.target.value)} className="w-44">
              <option value="">{t('page.allServers')}</option>
              {serverOptions.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#0b1224]">
                  {s.domain}
                </option>
              ))}
            </SelectInput>

            <Button variant="outline" icon={RefreshCw} loading={refreshing && Boolean(overview.data)} onClick={refresh}>
              {t('page.refresh')}
            </Button>
          </>
        }
      />

      {forbidden ? (
        <Card>
          <EmptyState
            icon={Lock}
            title={t('page.noAccess')}
            description={t('page.noAccessDesc')}
          />
        </Card>
      ) : (
        <>
          <SurgeBanner data={overview.data} />
          <Overview section={overview} range={range} onRetry={refresh} />

          <TimelineChart section={timeline} range={range} onRetry={refresh} />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <TopPanel section={top} by={topBy} onBy={setTopBy} onRetry={refresh} />
            <ServersPanel section={servers} onRetry={refresh} />
          </div>

          <ThreatMap section={threat} onRetry={refresh} />

          {updatedAt && (
            <p className="text-center text-xs text-slate-600">
              {t('page.updatedAt', {
                time: updatedAt.toLocaleTimeString(i18n.language.startsWith('ar') ? 'ar-EG' : 'en-GB'),
              })}
            </p>
          )}
        </>
      )}
    </PageShell>
  )
}
