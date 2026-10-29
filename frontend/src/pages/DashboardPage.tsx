// frontend/src/pages/DashboardPage.tsx
// ==================================================================
// Zero Plus - Dashboard Page
// Dashboard الرئيسية مع إحصائيات لحظية ورسوم بيانية
// (مربوطة بـ backend/modules/dashboard)
//
//   GET /dashboard/overview    → ملخص عام
//   GET /dashboard/timeline    → بيانات زمنية للرسوم البيانية
//   GET /dashboard/top         → أعلى المصادر (IP, Path, Country)
//   GET /dashboard/servers     → حالة جميع Servers
//   GET /dashboard/threat-map  → توزيع التهديدات جغرافياً
//
// الRefresh التلقائي كل 30 ثانية + Socket للأحداث اللحظية
// ==================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Globe,
  RefreshCw,
  Server as ServerIcon,
  Shield,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useToast } from '../components/ui/Toast'
import {
  Button,
  Card,
  ErrorState,
  PageHeader,
  PageShell,
  Skeleton,
  StatCard,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import apiClient from '../services/api'
import { getSocket, SocketEvents } from '../services/socket'
import type {
  DashboardOverview,
  DashboardRange,
  Server,
  ThreatCountry,
  TimelinePoint,
  TopEntry,
} from '../services/types'
import { cn, formatNumber, formatPercent } from '../utils/format'

// ==================================================================
// Constants
// ==================================================================

const RANGES: { value: DashboardRange; label: string }[] = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
]

const TOP_TABS: { value: string; label: string }[] = [
  { value: 'ip', label: 'IP addresses' },
  { value: 'path', label: 'Paths' },
  { value: 'country', label: 'Countries' },
  { value: 'stage', label: 'Detection stages' },
]

// ==================================================================
// Page Component
// ==================================================================

export default function DashboardPage() {
  const toast = useToast()

  // ---------------- State ----------------
  const [range, setRange] = useState<DashboardRange>('24h')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // ---------------- Data ----------------
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [topEntries, setTopEntries] = useState<TopEntry[]>([])
  const [topBy, setTopBy] = useState('ip')
  const [servers, setServers] = useState<Server[]>([])
  const [threatMap, setThreatMap] = useState<ThreatCountry[]>([])
  const [unknownCountryTotal, setUnknownCountryTotal] = useState(0)

  // ---------------- Load Data ----------------
  const load = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true)
      else setLoading(true)

      try {
        // جلب جميع البيانات بالتوازي لأداء أفضل
        const [overviewRes, timelineRes, serversRes, threatMapRes, topRes] =
          await Promise.all([
            apiClient.get<{ overview: DashboardOverview }>(
              '/dashboard/overview',
              { params: { range } },
            ),
            apiClient.get<{ points: TimelinePoint[] }>('/dashboard/timeline', {
              params: { range },
            }),
            apiClient.get<{
              servers: Server[]
              summary: Record<string, number>
            }>('/dashboard/servers'),
            apiClient.get<{
              countries: ThreatCountry[]
              unknownCountryTotal: number
            }>('/dashboard/threat-map', { params: { range } }),
            apiClient.get<{ entries: TopEntry[] }>('/dashboard/top', {
              params: { by: topBy, range, limit: 10 },
            }),
          ])

        const ov = (overviewRes.data as any).data ?? overviewRes.data.overview ?? overviewRes.data
        setOverview({
          total: ov.traffic?.total ?? ov.total ?? 0,
          allowed: ov.traffic?.allowed ?? ov.allowed ?? 0,
          blocked: ov.traffic?.blocked ?? ov.blocked ?? 0,
          challenged: ov.traffic?.challenged ?? ov.challenged ?? 0,
          rateLimited: ov.traffic?.rateLimited ?? ov.rateLimited ?? 0,
          monitored: ov.traffic?.monitored ?? ov.monitored ?? 0,
          avgScore: ov.risk?.avgScore ?? ov.avgScore ?? 0,
          surgeDetected: ov.risk?.surgeDetected ?? ov.surgeDetected ?? false,
          surgeCount: ov.risk?.surgeCount ?? ov.surgeCount ?? 0,
          challengesTotal: ov.challenges?.total ?? ov.challengesTotal ?? 0,
          challengesPassed: ov.challenges?.passed ?? ov.challengesPassed ?? 0,
          challengesFailed: ov.challenges?.failed ?? ov.challengesFailed ?? 0,
          serversByStatus: ov.servers ?? ov.serversByStatus ?? {},
          activeBans: ov.reputation?.activeBans ?? ov.activeBans ?? 0,
          permanentBans: ov.reputation?.permanentBans ?? ov.permanentBans ?? 0,
          criticalBans: ov.reputation?.criticalEntries ?? ov.criticalBans ?? 0,
          newBansInPeriod: ov.reputation?.newBansInPeriod ?? ov.newBansInPeriod ?? 0,
          unreadNotifications: ov.unreadNotifications ?? 0,
        } as any)
        const tl = (timelineRes.data as any).data ?? timelineRes.data
        setTimeline(tl.points ?? tl ?? [])
        const sv = (serversRes.data as any).data ?? serversRes.data
        setServers(sv.servers ?? sv ?? [])
        const tm = (threatMapRes.data as any).data ?? threatMapRes.data
        setThreatMap(tm.countries ?? tm ?? [])
        setUnknownCountryTotal(tm.unknownCountryTotal ?? 0)
        const top = (topRes.data as any).data ?? topRes.data
        setTopEntries(top.items ?? top.entries ?? top ?? [])
        setError(null)
      } catch (err) {
        const { message } = parseApiError(err)
        setError(message)
        toast.error('فشل تحميل البيانات', message)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [range, topBy, toast],
  )

  // ---------------- Initial Load ----------------
  useEffect(() => {
    void load()
  }, [load])

  // ---------------- Auto Refresh كل 30 ثانية ----------------
  useEffect(() => {
    const interval = setInterval(() => {
      void load(true)
    }, 30000)

    return () => clearInterval(interval)
  }, [load])

  // ---------------- Socket Listeners ----------------
  useEffect(() => {
    const socket = getSocket()

    // الاستماع لتحديثات حالات السيرفر
    const handleServerStatus = (payload: any) => {
      setServers((prev) => {
        const exists = prev.find((s) => s.id === payload.id)
        if (exists) {
          return prev.map((s) =>
            s.id === payload.id ? { ...s, ...payload } : s,
          )
        }
        if (payload.action === 'created') {
          return [payload, ...prev]
        }
        if (payload.action === 'deleted') {
          return prev.filter((s) => s.id !== payload.id)
        }
        return prev
      })
    }

    socket.on(SocketEvents.SERVER_STATUS, handleServerStatus)

    return () => {
      socket.off(SocketEvents.SERVER_STATUS, handleServerStatus)
    }
  }, [])

  // ---------------- Derived Data ----------------
  const stats = useMemo(() => {
    if (!overview) return null
    return {
      total: overview.total,
      allowed: overview.allowed,
      blocked: overview.blocked,
      challenged: overview.challenged,
      blockRate:
        overview.total > 0 ? (overview.blocked / overview.total) * 100 : 0,
      avgScore: overview.avgScore,
      surgeDetected: overview.surgeDetected,
    }
  }, [overview])

  const serverStats = useMemo(() => {
    const online = servers.filter((s) => s.status === 'ONLINE').length
    const offline = servers.filter((s) => s.status === 'OFFLINE').length
    const degraded = servers.filter((s) => s.status === 'DEGRADED').length
    const maintenance = servers.filter((s) => s.status === 'MAINTENANCE').length
    return { online, offline, degraded, maintenance, total: servers.length }
  }, [servers])

  // ==================================================================
  // Render
  // ==================================================================

  return (
    <PageShell>
      {/* ---------- Header ---------- */}
      <PageHeader
        icon={Activity}
        title="Dashboard"
        subtitle="Real-time security posture and traffic overview"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {/* Range Selector */}
            <div className="flex gap-1 rounded-lg bg-white/5 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRange(r.value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                    range === r.value
                      ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/30'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Refresh Button */}
            <Button
              icon={RefreshCw}
              loading={refreshing}
              onClick={() => void load(true)}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* ---------- Error State ---------- */}
      {error && !overview ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : loading || !overview || !stats ? (
        /* ---------- Loading Skeleton ---------- */
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-2xl" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-80 w-full rounded-2xl" />
            <Skeleton className="h-80 w-full rounded-2xl" />
          </div>
        </div>
      ) : (
        <>
          {/* ---------- Stats Grid ---------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total requests"
              value={formatNumber(stats.total)}
              icon={Activity}
              tone="indigo"
              delay={0}
            />
            <StatCard
              label="Allowed"
              value={formatNumber(stats.allowed)}
              icon={Shield}
              tone="emerald"
              delay={60}
            />
            <StatCard
              label="Blocked"
              value={formatNumber(stats.blocked)}
              icon={AlertTriangle}
              tone="rose"
              delay={120}
            />
            <StatCard
              label="Challenged"
              value={formatNumber(stats.challenged)}
              icon={ShieldAlert}
              tone="amber"
              delay={180}
            />
          </div>

          {/* ---------- Surge Alert ---------- */}
          {stats.surgeDetected && (
            <div className="zp-anim-scale-in flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              <AlertTriangle className="h-5 w-5 shrink-0 animate-pulse" />
              <span>
                تم اكتشاف زيادة مفاجئة في حركة المرور! Avg risk:{' '}
                <strong className="text-rose-100">
                  {stats.avgScore.toFixed(1)}
                </strong>
              </span>
            </div>
          )}

          {/* ---------- Timeline Chart ---------- */}
          <Card className="p-6" delay={240}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                حركة المرور عبر الزمن
              </h3>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  Total
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Allowed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  Blocked
                </span>
              </div>
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline}>
                  <defs>
                    <linearGradient
                      id="colorTotal"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient
                      id="colorBlocked"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: '#e2e8f0' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#06b6d4"
                    fillOpacity={1}
                    fill="url(#colorTotal)"
                  />
                  <Area
                    type="monotone"
                    dataKey="blocked"
                    stroke="#f43f5e"
                    fillOpacity={1}
                    fill="url(#colorBlocked)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ---------- Top Data & Threat Map ---------- */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top Sources */}
            <Card className="p-6" delay={300}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  أعلى المصادر
                </h3>
                <div className="flex gap-1 rounded-lg bg-white/5 p-1">
                  {TOP_TABS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setTopBy(t.value)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                        topBy === t.value
                          ? 'bg-cyan-500 text-white'
                          : 'text-slate-400 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {topEntries.map((entry, i) => (
                  <div
                    key={i}
                    className="zp-anim-fade-up flex items-center gap-3"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <span className="w-6 text-xs font-medium text-slate-500">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {entry.label}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                        <span>{formatNumber(entry.total)} طلب</span>
                        <span>•</span>
                        <span className="text-rose-400">
                          {formatNumber(entry.blocked)} Blocked
                        </span>
                      </div>
                    </div>
                    <div className="w-24">
                      <div className="h-2 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-rose-500 transition-all duration-500"
                          style={{
                            width: `${(entry.blocked / Math.max(entry.total, 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Threat Map */}
            <Card className="p-6" delay={360}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Globe className="h-5 w-5 text-cyan-400" />
                  خريطة التهديدات
                </h3>
              </div>

              <div className="space-y-2">
                {threatMap.slice(0, 8).map((country, i) => (
                  <div
                    key={country.code}
                    className="zp-anim-fade-up flex items-center justify-between rounded-lg bg-white/3 p-3 transition-all hover:bg-white/5"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">
                        {getCountryFlag(country.code)}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {country.code}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatNumber(country.total)} طلب
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Block rate</p>
                        <p className="text-sm font-semibold text-white">
                          {formatPercent(country.blockRate)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          country.threatLevel === 'critical' &&
                            'bg-rose-500/20 text-rose-400',
                          country.threatLevel === 'high' &&
                            'bg-orange-500/20 text-orange-400',
                          country.threatLevel === 'medium' &&
                            'bg-amber-500/20 text-amber-400',
                          country.threatLevel === 'low' &&
                            'bg-emerald-500/20 text-emerald-400',
                        )}
                      >
                        {country.threatLevel}
                      </span>
                    </div>
                  </div>
                ))}

                {unknownCountryTotal > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-white/3 p-3 text-sm">
                    <span className="text-slate-400">Unknown countries</span>
                    <span className="font-medium text-white">
                      {formatNumber(unknownCountryTotal)}
                    </span>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* ---------- Servers Summary ---------- */}
          <Card className="p-6" delay={420}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <ServerIcon className="h-5 w-5 text-cyan-400" />
                Servers ({serverStats.total})
              </h3>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  {serverStats.online} Online
                </span>
                <span className="flex items-center gap-1.5">
                  <XCircle className="h-3 w-3 text-rose-400" />
                  {serverStats.offline} Offline
                </span>
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                  {serverStats.degraded} أداء منخفض
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {servers.slice(0, 6).map((server, i) => (
                <div
                  key={server.id}
                  className="zp-anim-fade-up rounded-xl border border-white/8 bg-white/3 p-4 transition-all hover:border-white/15 hover:bg-white/5"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-white truncate">
                      {server.domain}
                    </p>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        server.status === 'ONLINE' &&
                          'bg-emerald-500/20 text-emerald-400',
                        server.status === 'OFFLINE' &&
                          'bg-rose-500/20 text-rose-400',
                        server.status === 'DEGRADED' &&
                          'bg-amber-500/20 text-amber-400',
                        server.status === 'MAINTENANCE' &&
                          'bg-indigo-500/20 text-indigo-400',
                      )}
                    >
                      {server.status}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-400">
                    <div className="flex justify-between">
                      <span>Safe capacity</span>
                      <span className="font-medium text-white">
                        {formatNumber(server.safeRequestsPerSecond)} req/s
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Response time</span>
                      <span className="font-medium text-white">
                        {server.avgResponseTimeMs
                          ? `${server.avgResponseTimeMs}ms`
                          : '—'}
                      </span>
                    </div>
                    {server.probeRecommendation && (
                      <div className="flex justify-between">
                        <span>Recommendation</span>
                        <span className="font-medium text-white">
                          {server.probeRecommendation}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </PageShell>
  )
}

// ==================================================================
// Helpers
// ==================================================================

function getCountryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌍'
  const cc = code.toUpperCase()
  return String.fromCodePoint(
    ...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  )
}