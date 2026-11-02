// frontend/src/pages/simulation/RunEventsTable.tsx
// ==================================================================
// Live Security Events (مفلتر بـ simulationRunId)
// الأعمدة: Time • IP • Path • Decision • Risk • Stage • Latency • Persona
// الضغط على الصف بيفتح EventDrawer الموجود (reasonSummary + reasonDetails)
// ==================================================================

import { ChevronRight, ShieldQuestion } from 'lucide-react'

import RiskGauge from '../../components/RiskGauge'
import { Badge, DecisionBadge, EmptyState, ErrorState, Skeleton } from '../../components/ui/kit'
import type { SecurityEvent } from '../../services/eventsService'
import type { Decision } from '../../services/types'
import { cn, truncate } from '../../utils/format'

const COLUMNS = ['Time', 'IP', 'Path', 'Decision', 'Risk', 'Stage', 'Latency', 'Persona', '']

/** خط جانبي ملوّن للتفرقة البصرية بين القرارات */
const DECISION_EDGE: Record<Decision, string> = {
  ALLOW: 'border-l-emerald-400/70',
  MONITOR: 'border-l-sky-400/70',
  CHALLENGE: 'border-l-indigo-400/80',
  RATE_LIMIT: 'border-l-amber-400/80',
  BLOCK: 'border-l-rose-400/90',
}

const DECISION_ROW_TINT: Record<Decision, string> = {
  ALLOW: '',
  MONITOR: '',
  CHALLENGE: 'bg-indigo-500/3',
  RATE_LIMIT: 'bg-amber-500/3',
  BLOCK: 'bg-rose-500/4',
}

const METHOD_TONE: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-cyan-400',
  PUT: 'text-amber-400',
  PATCH: 'text-amber-400',
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
    return <ErrorState message={error} onRetry={onRetry} />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-225 text-left">
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
          {/* ---------- Loading skeleton ---------- */}
          {hasRun &&
            loading &&
            events.length === 0 &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-white/4">
                {COLUMNS.map((c, j) => (
                  <td key={`${c}-${j}`} className="px-5 py-4">
                    <Skeleton className="h-4 w-full max-w-30" />
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
                  'group cursor-pointer border-b border-l-2 border-white/4 hover:bg-white/4',
                  DECISION_EDGE[event.decision] ?? 'border-l-transparent',
                  DECISION_ROW_TINT[event.decision],
                )}
              >
                <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-slate-300">{timeOf(event.createdAt)}</td>

                <td className="px-5 py-3 font-mono text-sm text-white">{event.ipAddress}</td>

                <td className="max-w-56 px-5 py-3">
                  <p className="truncate font-mono text-sm text-slate-200" title={event.path}>
                    <span className={cn('mr-2 font-semibold', METHOD_TONE[event.method] ?? 'text-slate-400')}>
                      {event.method}
                    </span>
                    {truncate(event.path, 32)}
                  </p>
                </td>

                <td className="px-5 py-3">
                  <DecisionBadge decision={event.decision} />
                </td>

                <td className="px-5 py-3">
                  <RiskGauge score={event.riskScore} />
                </td>

                <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-400">
                  {event.decidedAtStage ? event.decidedAtStage.replaceAll('_', ' ') : '—'}
                </td>

                <td className="whitespace-nowrap px-5 py-3 text-xs tabular-nums text-slate-300">
                  {event.processingTimeMs !== null ? `${event.processingTimeMs} ms` : '—'}
                </td>

                <td className="px-5 py-3">
                  {persona ? <Badge tone="slate" className="font-mono normal-case">{persona}</Badge> : <span className="text-slate-600">—</span>}
                </td>

                <td className="px-3 py-3 text-slate-600">
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-400" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ---------- Empty ---------- */}
      {!loading && events.length === 0 && (
        <EmptyState
          icon={ShieldQuestion}
          title={!hasRun ? 'No run selected' : running ? 'Waiting for events…' : 'No events for this run'}
          description={
            !hasRun
              ? 'Start a simulation or open a previous run to see its security events.'
              : running
                ? 'Events appear here as soon as the Gateway starts deciding on simulated requests.'
                : 'No security events are linked to this run.'
          }
        />
      )}
    </div>
  )
}