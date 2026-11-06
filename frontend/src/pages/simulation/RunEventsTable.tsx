// frontend/src/pages/simulation/RunEventsTable.tsx
// ==================================================================
// Live Security Events (filtered by simulationRunId)
// Columns: Time • IP • Path • Decision • Risk • Stage • Latency • Persona
// Clicking a row opens the existing EventDrawer (reasonSummary + reasonDetails)
// ==================================================================

import { ChevronRight, ShieldQuestion } from 'lucide-react'

import RiskGauge from '../../components/RiskGauge'
import {
  Badge,
  DecisionBadge,
  EmptyState,
  ErrorState,
  Skeleton,
} from '../../components/ui/kit'
import type { SecurityEvent } from '../../services/eventsService'
import type { Decision } from '../../services/types'
import { cn, truncate } from '../../utils/format'

const COLUMNS = [
  'Time',
  'IP',
  'Path',
  'Decision',
  'Risk',
  'Stage',
  'Latency',
  'Persona',
  '',
] as const

/** Colored left edge for visual decision separation */
const DECISION_EDGE: Record<Decision, string> = {
  ALLOW: 'border-l-emerald-400/80',
  MONITOR: 'border-l-sky-400/80',
  CHALLENGE: 'border-l-indigo-400/90',
  RATE_LIMIT: 'border-l-amber-400/90',
  BLOCK: 'border-l-rose-400',
}

const DECISION_ROW_TINT: Record<Decision, string> = {
  ALLOW: '',
  MONITOR: '',
  CHALLENGE: 'bg-indigo-500/[0.04]',
  RATE_LIMIT: 'bg-amber-500/[0.04]',
  BLOCK: 'bg-rose-500/[0.05]',
}

const METHOD_TONE: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-cyan-400',
  PUT: 'text-amber-400',
  PATCH: 'text-amber-300',
  DELETE: 'text-rose-400',
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-GB')
}

function personaOf(event: SecurityEvent): string | null {
  const p = event.reasonDetails?.['persona']
  return typeof p === 'string' && p ? p : null
}

export default function RunEventsTable({
  events,
  loading,
  error,
  hasRun,
  running,
  onRetry,
  onRowClick,
}: {
  events: SecurityEvent[]
  loading: boolean
  error: string | null
  hasRun: boolean
  running: boolean
  onRetry: () => void
  onRowClick: (event: SecurityEvent) => void
}) {
  if (error && events.length === 0) {
    return (
      <div className="px-5 py-10">
        <ErrorState message={error} onRetry={onRetry} />
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-225 text-left">
        <thead>
          <tr className="border-b border-white/8 bg-white/2">
            {COLUMNS.map((col, i) => (
              <th
                key={`${col}-${i}`}
                className={cn(
                  'px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500',
                  i === 0 && 'pl-5',
                  i === COLUMNS.length - 1 && 'pr-4',
                )}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {/* ---------- Loading skeleton ---------- */}
          {hasRun &&
            loading &&
            events.length === 0 &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-white/5">
                {COLUMNS.map((c, j) => (
                  <td
                    key={`${c}-${j}`}
                    className={cn('px-4 py-4', j === 0 && 'pl-5')}
                  >
                    <Skeleton
                      className={cn(
                        'h-4 rounded-md',
                        j === 2 ? 'w-36' : j === 1 ? 'w-28' : 'w-16',
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}

          {/* ---------- Rows ---------- */}
          {events.slice(0, 50).map((event) => {
            const persona = personaOf(event)

            return (
              <tr
                key={event.id}
                onClick={() => onRowClick(event)}
                className={cn(
                  'group cursor-pointer border-b border-l-[3px] border-white/5 transition-colors',
                  'hover:bg-white/4',
                  DECISION_EDGE[event.decision] ?? 'border-l-transparent',
                  DECISION_ROW_TINT[event.decision],
                )}
              >
                {/* Time */}
                <td className="whitespace-nowrap px-4 py-3.5 pl-5 font-mono text-xs text-slate-400">
                  {timeOf(event.createdAt)}
                </td>

                {/* IP */}
                <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[13px] text-white">
                  {event.ipAddress}
                </td>

                {/* Path */}
                <td className="max-w-55 px-4 py-3.5">
                  <p
                    className="truncate font-mono text-[13px] text-slate-200"
                    title={`${event.method} ${event.path}`}
                  >
                    <span
                      className={cn(
                        'mr-2 font-semibold',
                        METHOD_TONE[event.method] ?? 'text-slate-400',
                      )}
                    >
                      {event.method}
                    </span>
                    <span className="text-slate-300">{truncate(event.path, 28)}</span>
                  </p>
                </td>

                {/* Decision */}
                <td className="px-4 py-3.5">
                  <DecisionBadge decision={event.decision} />
                </td>

                {/* Risk */}
                <td className="px-4 py-3.5">
                  <div className="min-w-18">
                    <RiskGauge score={event.riskScore} />
                  </div>
                </td>

                {/* Stage */}
                <td className="whitespace-nowrap px-4 py-3.5 text-xs capitalize text-slate-400">
                  {event.decidedAtStage
                    ? event.decidedAtStage.replaceAll('_', ' ').toLowerCase()
                    : '—'}
                </td>

                {/* Latency */}
                <td className="whitespace-nowrap px-4 py-3.5 text-xs tabular-nums text-slate-300">
                  {event.processingTimeMs !== null
                    ? `${event.processingTimeMs} ms`
                    : '—'}
                </td>

                {/* Persona */}
                <td className="px-4 py-3.5">
                  {persona ? (
                    <Badge tone="slate" className="font-mono normal-case tracking-normal">
                      {persona}
                    </Badge>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>

                {/* Chevron */}
                <td className="px-3 py-3.5 text-slate-600">
                  <ChevronRight className="h-4 w-4 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-400" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ---------- Empty ---------- */}
      {!loading && events.length === 0 && (
        <div className="px-5 py-12">
          <EmptyState
            icon={ShieldQuestion}
            title={
              !hasRun
                ? 'No run selected'
                : running
                  ? 'Waiting for events…'
                  : 'No events for this run'
            }
            description={
              !hasRun
                ? 'Start a simulation or open a previous run to see its security events.'
                : running
                  ? 'Events appear here as soon as the Gateway starts deciding on simulated requests.'
                  : 'No security events are linked to this run.'
            }
          />
        </div>
      )}
    </div>
  )
}