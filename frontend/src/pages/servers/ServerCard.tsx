// frontend/src/pages/servers/ServerCard.tsx
// ==================================================================
// Zero Plus - Server Card
// كارت السيرفر: الحالة + إعداد الـ DNS + الصحة + الأزرار
// ==================================================================

import {
  CheckCircle2,
  Circle,
  Cpu,
  Globe,
  Lock,
  LockOpen,
  Pencil,
  Server as ServerIcon,
  Trash2,
  Wrench,
} from 'lucide-react'

import { Badge, Button, Card } from '../../components/ui/kit'
import { type Server } from '../../services/serversService'
import { cn, timeAgo } from '../../utils/format'
import { STATUS_META } from './shared'

// ==================================================================
// Component
// ==================================================================

export function ServerCard({
  server,
  index,
  canManage,
  busy,
  onDns,
  onEdit,
  onDelete,
  onMaintenance,
}: {
  server: Server
  index: number
  canManage: boolean
  busy: boolean
  onDns: () => void
  onEdit: () => void
  onDelete: () => void
  onMaintenance: () => void
}) {
  const meta = STATUS_META[server.status]
  const inMaintenance = server.status === 'MAINTENANCE'
  const fullySetUp = server.dnsVerified && server.gatewayReachable

  const load = server.currentLoadPercent
  const loadTone =
    load === null
      ? ''
      : load >= 85
        ? 'bg-rose-500'
        : load >= 60
          ? 'bg-amber-400'
          : 'bg-emerald-400'

  return (
    <Card
      delay={Math.min(index, 8) * 50}
      className={cn(
        'flex min-h-85 flex-col p-5',
        busy && 'pointer-events-none opacity-60',
      )}
    >
      {/* ============================================================
          Header – Domain + Status
      ============================================================ */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-cyan-300">
            <ServerIcon className="h-5 w-5" />
            {server.status === 'ONLINE' && (
              <span className="zp-anim-pulse-ring absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400" />
            )}
          </div>

          <div className="min-w-0">
            <p
              className="truncate text-sm font-semibold text-white"
              title={server.domain}
            >
              {server.domain}
            </p>
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              {server.originIp}:{server.originPort}
            </p>
          </div>
        </div>

        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
      </div>

      {/* ============================================================
          Tags – Mode + SSL
      ============================================================ */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={server.mode === 'PROTECT' ? 'cyan' : 'amber'}>
          {server.mode === 'PROTECT' ? 'Protect' : 'Monitor only'}
        </Badge>

        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs',
            server.sslEnabled ? 'text-slate-400' : 'text-amber-400',
          )}
        >
          {server.sslEnabled ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <LockOpen className="h-3.5 w-3.5" />
          )}
          {server.sslEnabled ? 'HTTPS origin' : 'HTTP origin'}
        </span>
      </div>

      {/* ============================================================
          DNS Setup Checklist
      ============================================================ */}
      <div className="mt-4 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          DNS Setup
        </p>

        <div className="grid grid-cols-2 gap-2">
          {[
            {
              label: 'Ownership',
              description: 'TXT record',
              ok: server.dnsVerified,
            },
            {
              label: 'Routing',
              description: 'CNAME / A',
              ok: server.gatewayReachable,
            },
          ].map((step) => (
            <div
              key={step.label}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-3 py-2.5',
                step.ok
                  ? 'border-emerald-400/20 bg-emerald-500/5'
                  : 'border-white/6 bg-white/2',
              )}
            >
              {step.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-slate-600" />
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-xs font-medium',
                    step.ok ? 'text-slate-200' : 'text-slate-400',
                  )}
                >
                  {step.label}
                </p>
                <p className="text-[10px] text-slate-600">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ============================================================
          Health – Load + Response time
      ============================================================ */}
      <div className="mt-4 space-y-2.5">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              Load
            </span>
            <span className="font-medium text-slate-300">
              {load !== null ? `${load.toFixed(0)}%` : '—'}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            {load !== null && (
              <div
                className={cn('zp-anim-bar h-full rounded-full', loadTone)}
                style={{ width: `${Math.min(100, load)}%` }}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>
            Avg response{' '}
            <span className="font-medium text-slate-300">
              {server.avgResponseTimeMs !== null
                ? `${server.avgResponseTimeMs} ms`
                : '—'}
            </span>
          </span>
          <span>
            Checked{' '}
            <span className="font-medium text-slate-300">
              {timeAgo(server.lastHealthCheckAt)}
            </span>
          </span>
        </div>
      </div>

      {/* ============================================================
          Actions – DNS + Maintenance + Edit/Delete
          (mt-auto عشان الأزرار تفضل تحت دايمًا)
      ============================================================ */}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-white/6 pt-4">
        {/* زرار DNS – الأهم */}
        <Button
          size="sm"
          variant={fullySetUp ? 'outline' : 'primary'}
          icon={Globe}
          onClick={onDns}
          className="min-w-27.5"
        >
          {fullySetUp ? 'DNS details' : 'Finish setup'}
        </Button>

        {canManage && (
          <>
            <Button
              size="sm"
              icon={Wrench}
              disabled={busy}
              onClick={onMaintenance}
              className="min-w-30"
            >
              {inMaintenance ? 'End maintenance' : 'Maintenance'}
            </Button>

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={onEdit}
                title="Edit server"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
              >
                <Pencil className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onDelete}
                title="Delete server"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}