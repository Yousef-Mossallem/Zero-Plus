// frontend/src/pages/simulation/RunsHistory.tsx
// ==================================================================
// Previous Runs: Date • Pattern • Duration • Total Sent • Blocked % • Status • View
// ==================================================================

import { Eye, History } from 'lucide-react'

import { Badge, Button, EmptyState, ErrorState, Skeleton } from '../../components/ui/kit'
import type { SimulationRun } from '../../services/simulationsService'
import { cn, formatDateTime, formatNumber, formatPercent } from '../../utils/format'
import { blockedPercent, formatDuration, STATUS_TONE } from './shared'

const COLUMNS = ['Date', 'Pattern', 'Duration', 'Total Sent', 'Blocked %', 'Status', '']

export default function RunsHistory({
  items,
  loading,
  error,
  selectedId,
  /** لو فيه Run شغال: بنقفل View لأي Run تاني عشان متابعة الـ Live ماتتقطعش */
  lockedRunId,
  onRetry,
  onView,
}: {
  items: SimulationRun[]
  loading: boolean
  error: string | null
  selectedId: string | null
  lockedRunId: string | null
  onRetry: () => void
  onView: (run: SimulationRun) => void
}) {
  if (error && items.length === 0) return <ErrorState message={error} onRetry={onRetry} />

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-180 text-left">
        <thead>
          <tr className="border-b border-white/6">
            {COLUMNS.map((col, i) => (
              <th
                key={`${col}-${i}`}
                className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {loading &&
            items.length === 0 &&
            Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b border-white/4">
                {COLUMNS.map((c, j) => (
                  <td key={`${c}-${j}`} className="px-5 py-4">
                    <Skeleton className="h-4 w-full max-w-24" />
                  </td>
                ))}
              </tr>
            ))}

          {items.map((run) => {
            const blocked = blockedPercent(run.totals)
            const disabled = lockedRunId !== null && lockedRunId !== run.id
            return (
              <tr
                key={run.id}
                className={cn(
                  'border-b border-white/4 hover:bg-white/3',
                  selectedId === run.id && 'bg-cyan-500/5',
                  loading && 'opacity-60',
                )}
              >
                <td className="whitespace-nowrap px-5 py-3.5 text-sm text-slate-200">{formatDateTime(run.startedAt)}</td>
                <td className="px-5 py-3.5 font-mono text-sm text-slate-300">{run.pattern || '—'}</td>
                <td className="whitespace-nowrap px-5 py-3.5 text-sm tabular-nums text-slate-300">
                  {formatDuration(run.durationSec)}
                </td>
                <td className="px-5 py-3.5 text-sm tabular-nums text-white">{formatNumber(run.totals.sent)}</td>
                <td className="px-5 py-3.5 text-sm tabular-nums text-slate-300">{formatPercent(blocked)}</td>
                <td className="px-5 py-3.5">
                  <Badge tone={STATUS_TONE[run.status]} dot>
                    {run.status}
                  </Badge>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Button
                    size="sm"
                    icon={Eye}
                    disabled={disabled}
                    title={disabled ? 'Stop or wait for the current run to finish first' : 'View this run'}
                    onClick={() => onView(run)}
                  >
                    View
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {!loading && items.length === 0 && (
        <EmptyState
          icon={History}
          title="No previous runs"
          description="Completed and stopped simulations will be listed here."
        />
      )}
    </div>
  )
}