// frontend/src/pages/simulation/LiveBar.tsx
// ==================================================================
// Live Simulation Bar: shown only while RUNNING
// Progress + approximate live RPS + Stop + short Run ID
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
    <Card className="overflow-hidden p-0" accent>
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:gap-6">
        {/* ---------- Progress block ---------- */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="zp-anim-pulse-ring absolute inline-flex h-full w-full rounded-full bg-cyan-400/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400" />
              </span>
              <p className="text-sm font-semibold text-white">Simulation running</p>
              <Badge tone="slate" className="font-mono normal-case tracking-normal">
                {shortId(run.id)}
              </Badge>
            </div>

            <p className="shrink-0 text-xs tabular-nums text-slate-400">
              {elapsed !== null ? formatClock(elapsed) : '--:--'}
              <span className="mx-1 text-slate-600">/</span>
              {total !== null ? formatClock(total) : '--:--'}
            </p>
          </div>

          <div
            className="h-2.5 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct !== null ? Math.round(pct) : undefined}
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-cyan-400 via-cyan-400 to-blue-500 transition-[width] duration-700 ease-out"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        </div>

        {/* ---------- Stats + Stop ---------- */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex min-w-30 items-center gap-2.5 rounded-xl border border-white/8 bg-white/3 px-3.5 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
              <Gauge className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Live RPS
              </p>
              <p className="text-sm font-semibold tabular-nums text-white">
                {rps !== null ? `≈ ${rps.toFixed(1)}` : 'N/A'}
              </p>
            </div>
          </div>

          <div className="flex min-w-27.5 items-center gap-2.5 rounded-xl border border-white/8 bg-white/3 px-3.5 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
              <Timer className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Progress
              </p>
              <p className="text-sm font-semibold tabular-nums text-white">
                {pct !== null ? `${Math.round(pct)}%` : 'N/A'}
              </p>
            </div>
          </div>

          <Button
            variant="danger"
            icon={Square}
            loading={stopping}
            disabled={!canStop}
            onClick={onStop}
            className="shrink-0"
          >
            Stop
          </Button>
        </div>
      </div>

      {/* ---------- Poll error ---------- */}
      {pollError && (
        <div className="border-t border-amber-400/20 bg-amber-500/8 px-5 py-3">
          <p className="flex items-start gap-2.5 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Live updates are delayed — retrying.
              <span className="ml-1 text-amber-200/70">({pollError})</span>
            </span>
          </p>
        </div>
      )}
    </Card>
  )
}