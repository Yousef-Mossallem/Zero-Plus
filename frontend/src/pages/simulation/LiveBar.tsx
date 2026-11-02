// frontend/src/pages/simulation/LiveBar.tsx
// ==================================================================
// Live Simulation Bar: بيظهر فقط أثناء RUNNING
// Progress + RPS لحظي تقريبي + Stop + Run ID مختصر
// ==================================================================

import { AlertTriangle, Gauge, Square, Timer } from 'lucide-react'

import { Badge, Button, Card } from '../../components/ui/kit'
import type { SimulationRun } from '../../services/simulationsService'
import { elapsedSec, formatClock, progressPercent, shortId } from './shared'

export default function LiveBar({
  run,
  now,
  rps,
  stopping,
  canStop,
  pollError,
  onStop,
}: {
  run: SimulationRun
  now: number
  rps: number | null
  stopping: boolean
  canStop: boolean
  pollError: string | null
  onStop: () => void
}) {
  const pct = progressPercent(run, now)
  const elapsed = elapsedSec(run, now)
  const total = run.durationSec

  return (
    <Card className="p-5" accent>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="zp-anim-pulse-ring absolute inline-flex h-full w-full rounded-full bg-cyan-400/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400" />
              </span>
              <p className="text-sm font-semibold text-white">Simulation running</p>
              <Badge tone="slate" className="font-mono normal-case" >
                {shortId(run.id)}
              </Badge>
            </div>
            <p className="text-xs tabular-nums text-slate-400">
              {elapsed !== null ? formatClock(elapsed) : '--:--'} / {total !== null ? formatClock(total) : '--:--'}
            </p>
          </div>

          <div
            className="h-2 overflow-hidden rounded-full bg-white/8"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct !== null ? Math.round(pct) : undefined}
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-cyan-400 to-blue-500 transition-[width] duration-700 ease-out"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-3.5 py-2">
            <Gauge className="h-4 w-4 text-cyan-400" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Live RPS (approx.)</p>
              <p className="text-sm font-semibold tabular-nums text-white">{rps !== null ? `≈ ${rps.toFixed(1)}` : 'N/A'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-3.5 py-2">
            <Timer className="h-4 w-4 text-indigo-400" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Progress</p>
              <p className="text-sm font-semibold tabular-nums text-white">{pct !== null ? `${Math.round(pct)}%` : 'N/A'}</p>
            </div>
          </div>

          <Button variant="danger" icon={Square} loading={stopping} disabled={!canStop} onClick={onStop}>
            Stop
          </Button>
        </div>
      </div>

      {pollError && (
        <p
          dir="auto"
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Live updates are delayed — retrying. ({pollError})
        </p>
      )}
    </Card>
  )
}