// frontend/src/pages/servers/ServerCard.tsx — Server card

import {
  Activity,
  CheckCircle2,
  Circle,
  Clock,
  Cpu,
  Gauge,
  Globe,
  Lock,
  LockOpen,
  Pencil,
  Server as ServerIcon,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Badge, Button, Card } from '../../components/ui/kit'
import {
  canRequestProbe,
  hasProbeData,
  type ProbeConfidence,
  type ProbeRecommendation,
  type Server,
} from '../../services/serversService'
import { cn, timeAgo } from '../../utils/format'
import { STATUS_META } from './shared'

// ==================================================================
// Server card
//
// Sections:
//   1. Header         → domain, origin, status
//   2. Tags           → mode, HTTP/HTTPS origin
//   3. Capacity       → safe RPS (primary), recommendation, confidence,
//                       max RPS, p95, p99 under load, error rate, last probe
//   4. Health         → current load bar, avg response, last health check
//   5. Setup          → ownership / routing / origin reachability
//   6. Actions        → DNS, re-measure capacity, maintenance, edit, delete
//
// Probe numbers can be null (not measured yet / reset after an origin change),
// so every value has an empty state.
// ==================================================================

const RECOMMENDATION_META: Record<ProbeRecommendation, { label: string; cls: string }> = {
  excellent: { label: 'Excellent', cls: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' },
  good: { label: 'Good', cls: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-300' },
  fair: { label: 'Fair', cls: 'border-amber-400/30 bg-amber-500/10 text-amber-300' },
  poor: { label: 'Poor', cls: 'border-orange-400/30 bg-orange-500/10 text-orange-300' },
  down: { label: 'Down', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
}

const CONFIDENCE_LEVEL: Record<ProbeConfidence, { bars: number; label: string }> = {
  high: { bars: 3, label: 'High confidence' },
  medium: { bars: 2, label: 'Medium confidence' },
  low: { bars: 1, label: 'Low confidence' },
}

const fmtInt = (n: number) => n.toLocaleString('en-US')

function ConfidenceBars({ value }: { value: ProbeConfidence }) {
  const { bars, label } = CONFIDENCE_LEVEL[value]
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500" title={label}>
      <span className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn('w-1 rounded-sm', i <= bars ? 'bg-cyan-400' : 'bg-white/10')}
            style={{ height: `${4 + i * 3}px` }}
          />
        ))}
      </span>
      {label}
    </span>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-black/20 px-2.5 py-2">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn('mt-0.5 truncate text-sm font-semibold text-slate-200', tone)}>{value}</p>
    </div>
  )
}

function SetupItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-white/6 bg-white/2 px-2.5 py-2 text-xs">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-slate-600" />
      )}
      <span className={cn('truncate', ok ? 'text-slate-300' : 'text-slate-500')}>{label}</span>
    </div>
  )
}

export function ServerCard({
  server,
  index,
  canManage,
  busy,
  probing = false,
  onDns,
  onEdit,
  onDelete,
  onMaintenance,
  onProbe,
  onDetails,
}: {
  server: Server
  index: number
  canManage: boolean
  busy: boolean
  /** True while the probe request (POST /probe) is in flight or waiting for the Socket update */
  probing?: boolean
  onDns: () => void
  onEdit: () => void
  onDelete: () => void
  onDetails?: () => void
  onMaintenance: () => void
  /** Re-measure capacity (POST /servers/:id/probe → 202) */
  onProbe?: () => void
}) {
  const meta = STATUS_META[server.status]
  const inMaintenance = server.status === 'MAINTENANCE'
  const fullySetUp = server.dnsVerified && server.gatewayReachable

  const load = server.currentLoadPercent
  const loadTone = load === null ? '' : load >= 85 ? 'bg-rose-500' : load >= 60 ? 'bg-amber-400' : 'bg-emerald-400'

  const measured = hasProbeData(server)
  const probeAllowed = canRequestProbe(server)
  const recommendation = server.probeRecommendation ? RECOMMENDATION_META[server.probeRecommendation] : null
  const errorRate = server.probeErrorRate
  const errorTone =
    errorRate === null ? undefined : errorRate >= 5 ? 'text-rose-300' : errorRate >= 1 ? 'text-amber-300' : 'text-emerald-300'

  // Capacity panel state
  const capacityState: 'ready' | 'measuring' | 'needs-ownership' | 'not-measured' = measured
    ? 'ready'
    : probing
      ? 'measuring'
      : !probeAllowed
        ? 'needs-ownership'
        : 'not-measured'

  return (
    <Card delay={Math.min(index, 8) * 50} className={cn('flex flex-col overflow-hidden p-0', busy && 'opacity-60')}>
      {/* status accent line */}
      <div
        className={cn(
          'h-0.5 w-full',
          server.status === 'ONLINE' && 'bg-emerald-400/70',
          server.status === 'DEGRADED' && 'bg-amber-400/70',
          server.status === 'OFFLINE' && 'bg-rose-500/70',
          server.status === 'MAINTENANCE' && 'bg-indigo-400/70',
          server.status === 'PENDING' && 'bg-slate-500/50',
        )}
      />

      <div className="flex flex-1 flex-col p-5">
        {/* ---------- Header ---------- */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-cyan-300">
              <ServerIcon className="h-5 w-5" />
              {server.status === 'ONLINE' && (
                <span className="zp-anim-pulse-ring absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white" title={server.domain}>
                {server.domain}
              </p>
              <p dir="ltr" className="truncate font-mono text-xs text-slate-500">
                {server.originIp}:{server.originPort}
              </p>
            </div>
          </div>
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
        </div>

        {/* ---------- Tags ---------- */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={server.mode === 'PROTECT' ? 'cyan' : 'amber'}>
            {server.mode === 'PROTECT' ? 'Protect' : 'Monitor only'}
          </Badge>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              server.sslEnabled ? 'text-slate-400' : 'text-amber-400',
            )}
          >
            {server.sslEnabled ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            {server.sslEnabled ? 'HTTPS origin' : 'HTTP origin'}
          </span>
        </div>

        {/* ---------- Capacity ---------- */}
        <div className="mt-4 rounded-xl border border-white/8 bg-linear-to-br from-cyan-500/5 via-white/2 to-transparent p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Gauge className="h-3.5 w-3.5" />
              Safe capacity
            </span>
            {recommendation && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  recommendation.cls,
                )}
              >
                {recommendation.label}
              </span>
            )}
          </div>

          {capacityState === 'ready' ? (
            <>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums text-white">
                  {server.safeRequestsPerSecond !== null ? fmtInt(server.safeRequestsPerSecond) : '—'}
                </span>
                <span className="text-xs text-slate-500">req/s</span>
              </div>

              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-[11px] text-slate-500">
                  Max{' '}
                  <span className="text-slate-300">
                    {server.maxRequestsPerSecond !== null ? `${fmtInt(server.maxRequestsPerSecond)} req/s` : '—'}
                  </span>
                </span>
                {server.probeConfidence && <ConfidenceBars value={server.probeConfidence} />}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniStat
                  label="p95"
                  value={server.p95ResponseTimeMs !== null ? `${fmtInt(server.p95ResponseTimeMs)} ms` : '—'}
                />
                <MiniStat
                  label="p99 load"
                  value={server.loadLatencyP99Ms !== null ? `${fmtInt(server.loadLatencyP99Ms)} ms` : '—'}
                />
                <MiniStat
                  label="Errors"
                  value={errorRate !== null ? `${errorRate.toFixed(1)}%` : '—'}
                  tone={errorTone}
                />
              </div>

              <p className="mt-3 flex items-center gap-1 text-[11px] text-slate-600">
                <Clock className="h-3 w-3" />
                Measured {timeAgo(server.lastProbeAt)}
              </p>
            </>
          ) : (
            <div className="mt-3 flex items-center gap-3 text-sm">
              {capacityState === 'measuring' ? (
                <>
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400" />
                  </span>
                  <p className="text-slate-300">
                    Measuring capacity…
                    <span className="block text-xs text-slate-500">Results usually arrive within about 2 minutes.</span>
                  </p>
                </>
              ) : capacityState === 'needs-ownership' ? (
                <p className="text-slate-400">
                  Not measured yet
                  <span className="block text-xs text-slate-500">Verify domain ownership to start measuring.</span>
                </p>
              ) : (
                <p className="text-slate-400">
                  Not measured yet
                  <span className="block text-xs text-slate-500">
                    {canManage ? 'Click “Measure” to run a capacity test.' : 'An Owner or Admin can run a capacity test.'}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---------- Health ---------- */}
        <div className="mt-4 space-y-2.5">
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3" /> Current load
              </span>
              <span className="text-slate-300">{load !== null ? `${load.toFixed(0)}%` : '—'}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
              {load !== null && (
                <div
                  className={cn('zp-anim-bar h-full rounded-full', loadTone)}
                  style={{ width: `${Math.min(100, Math.max(0, load))}%` }}
                />
              )}
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              Avg response{' '}
              <span className="text-slate-300">
                {server.avgResponseTimeMs !== null ? `${fmtInt(server.avgResponseTimeMs)} ms` : '—'}
              </span>
            </span>
            <span>
              Checked <span className="text-slate-300">{timeAgo(server.lastHealthCheckAt)}</span>
            </span>
          </div>
        </div>

        {/* ---------- Setup checklist ---------- */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <SetupItem label="Ownership" ok={server.dnsVerified} />
          <SetupItem label="Routing" ok={server.gatewayReachable} />
          <SetupItem label="Origin" ok={server.originReachable} />
        </div>
{onDetails && (
  <Button size="sm" variant="ghost" icon={Gauge} onClick={onDetails}>
    Details
  </Button>
)}
        {/* ---------- Actions ---------- */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/6 pt-4">
          <Button size="sm" variant={fullySetUp ? 'outline' : 'primary'} icon={Globe} onClick={onDns}>
            {fullySetUp ? 'DNS' : 'Finish setup'}
          </Button>

          {canManage && (
            <>
              {onProbe && (
                <Button
                  size="sm"
                  icon={Gauge}
                  loading={probing}
                  disabled={busy || probing || !probeAllowed}
                  onClick={onProbe}
                >
                  {measured ? 'Re-measure' : 'Measure'}
                </Button>
              )}
              <Button size="sm" icon={Wrench} disabled={busy} onClick={onMaintenance}>
                {inMaintenance ? 'End maintenance' : 'Maintenance'}
              </Button>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={onEdit}
                  title="Edit"
                  aria-label="Edit server"
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  title="Delete"
                  aria-label="Delete server"
                  className="rounded-lg p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}