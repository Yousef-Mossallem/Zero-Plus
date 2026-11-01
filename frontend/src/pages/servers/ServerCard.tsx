// frontend/src/pages/servers/ServerCard.tsx — كارت السيرفر

import { CheckCircle2, Circle, Cpu, Globe, Lock, LockOpen, Pencil, Server as ServerIcon, Trash2, Wrench } from 'lucide-react'
import { Badge, Button, Card } from '../../components/ui/kit'
import { type Server } from '../../services/serversService'
import { cn, timeAgo } from '../../utils/format'
import { STATUS_META } from './shared'


// ==================================================================
// Server card
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
  const loadTone = load === null ? '' : load >= 85 ? 'bg-rose-500' : load >= 60 ? 'bg-amber-400' : 'bg-emerald-400'

  return (
    <Card delay={Math.min(index, 8) * 50} className={cn('flex flex-col p-5', busy && 'opacity-60')}>
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
            <p className="truncate text-sm font-semibold text-white" title={server.domain}>{server.domain}</p>
            <p className="font-mono text-xs text-slate-500">
              {server.originIp}:{server.originPort}
            </p>
          </div>
        </div>
        <Badge tone={meta.tone} dot>{meta.label}</Badge>
      </div>

      {/* ---------- Tags ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={server.mode === 'PROTECT' ? 'cyan' : 'amber'}>
          {server.mode === 'PROTECT' ? 'Protect' : 'Monitor only'}
        </Badge>
        <span className={cn('inline-flex items-center gap-1 text-xs', server.sslEnabled ? 'text-slate-400' : 'text-amber-400')}>
          {server.sslEnabled ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          {server.sslEnabled ? 'HTTPS origin' : 'HTTP origin'}
        </span>
      </div>

      {/* ---------- Setup checklist ---------- */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[
          { label: 'Ownership', ok: server.dnsVerified },
          { label: 'Routing', ok: server.gatewayReachable },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/2 px-3 py-2 text-xs">
            {s.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Circle className="h-4 w-4 text-slate-600" />}
            <span className={s.ok ? 'text-slate-300' : 'text-slate-500'}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ---------- Health ---------- */}
      <div className="mt-4 space-y-2.5">
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> Load</span>
            <span className="text-slate-300">{load !== null ? `${load.toFixed(0)}%` : '—'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
            {load !== null && (
              <div className={cn('zp-anim-bar h-full rounded-full', loadTone)} style={{ width: `${Math.min(100, load)}%` }} />
            )}
          </div>
        </div>
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>Avg response <span className="text-slate-300">{server.avgResponseTimeMs !== null ? `${server.avgResponseTimeMs} ms` : '—'}</span></span>
          <span>Checked <span className="text-slate-300">{timeAgo(server.lastHealthCheckAt)}</span></span>
        </div>
      </div>

      {/* ---------- Actions ---------- */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/6 pt-4">
        <Button size="sm" variant={fullySetUp ? 'outline' : 'primary'} icon={Globe} onClick={onDns}>
          {fullySetUp ? 'DNS' : 'Finish setup'}
        </Button>
        {canManage && (
          <>
            <Button size="sm" icon={Wrench} disabled={busy} onClick={onMaintenance}>
              {inMaintenance ? 'End maintenance' : 'Maintenance'}
            </Button>
            <div className="ml-auto flex gap-1">
              <button type="button" onClick={onEdit} title="Edit" className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={onDelete} title="Delete" className="rounded-lg p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
