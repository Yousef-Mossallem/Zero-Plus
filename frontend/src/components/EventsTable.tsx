// frontend/src/components/EventsTable.tsx
// ==================================================================
// Zero Plus - Events Table
// جدول عرض الأحداث الأمنية (قابل لإعادة الاستخدام في Dashboard/LiveTraffic لاحقًا)
// - الترتيب بالضغط على عنوان العمود (بيستدعي onSort والصفحة هي اللي تبعت للباك)
// - حالة تحميل (Skeleton) وحالة فاضي
// - الضغط على الصف بيفتح التفاصيل
// ==================================================================

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, ShieldQuestion } from 'lucide-react'

import RiskGauge from './RiskGauge'
import { Badge, DecisionBadge, EmptyState, Skeleton } from './ui/kit'
import { cn, formatDateTime, timeAgo, truncate } from '../utils/format'
import type { EventSortBy, SecurityEvent } from '../services/eventsService'

interface EventsTableProps {
  events: SecurityEvent[]
  loading: boolean
  sortBy: EventSortBy
  sortOrder: 'asc' | 'desc'
  onSort: (field: EventSortBy) => void
  onRowClick: (event: SecurityEvent) => void
  /** بيتعرض لما مفيش نتائج */
  emptyAction?: React.ReactNode
}

// الأعمدة اللي ينفع الترتيب بيها (الباك بيدعمها بس)
const SORTABLE: Partial<Record<string, EventSortBy>> = {
  Time: 'createdAt',
  IP: 'ipAddress',
  Risk: 'riskScore',
  Decision: 'decision',
}

const COLUMNS = ['Time', 'IP', 'Request', 'Server', 'Risk', 'Decision', 'Challenge', '']

const METHOD_TONE: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-cyan-400',
  PUT: 'text-amber-400',
  PATCH: 'text-amber-400',
  DELETE: 'text-rose-400',
}

function SortIcon({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />
  return order === 'asc' ? (
    <ArrowUp className="h-3 w-3 text-cyan-400" />
  ) : (
    <ArrowDown className="h-3 w-3 text-cyan-400" />
  )
}

function ChallengeCell({ event }: { event: SecurityEvent }) {
  if (!event.isChallenged) return <span className="text-slate-600">—</span>
  if (event.challengePassed === true) return <Badge tone="emerald">Passed</Badge>
  if (event.challengePassed === false) return <Badge tone="rose">Failed</Badge>
  return <Badge tone="amber">Pending</Badge>
}

export default function EventsTable({
  events,
  loading,
  sortBy,
  sortOrder,
  onSort,
  onRowClick,
  emptyAction,
}: EventsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-205 text-left">
        <thead>
          <tr className="border-b border-white/6">
            {COLUMNS.map((col) => {
              const field = SORTABLE[col]
              return (
                <th
                  key={col || 'actions'}
                  className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  {field ? (
                    <button
                      type="button"
                      onClick={() => onSort(field)}
                      className={cn(
                        'inline-flex items-center gap-1.5 hover:text-slate-300',
                        sortBy === field && 'text-slate-300',
                      )}
                    >
                      {col}
                      <SortIcon active={sortBy === field} order={sortOrder} />
                    </button>
                  ) : (
                    col
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {/* ---------- Loading skeleton ---------- */}
          {loading &&
            events.length === 0 &&
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-white/4">
                {COLUMNS.map((c, j) => (
                  <td key={`${c}-${j}`} className="px-5 py-4">
                    <Skeleton className="h-4 w-full max-w-30" />
                  </td>
                ))}
              </tr>
            ))}

          {/* ---------- Rows ---------- */}
          {events.map((event, index) => (
            <tr
              key={event.id}
              onClick={() => onRowClick(event)}
              style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
              className={cn(
                'zp-anim-fade-up group cursor-pointer border-b border-white/4 hover:bg-white/3',
                loading && 'opacity-60',
              )}
            >
              <td className="px-5 py-3.5">
                <p className="whitespace-nowrap text-sm text-slate-200">{timeAgo(event.createdAt)}</p>
                <p className="whitespace-nowrap text-[11px] text-slate-600">
                  {formatDateTime(event.createdAt)}
                </p>
              </td>

              <td className="px-5 py-3.5">
                <p className="font-mono text-sm text-white">{event.ipAddress}</p>
                <p className="text-[11px] text-slate-500">
                  {[event.countryCode, event.ipType?.replace('_', '/')].filter(Boolean).join(' · ') || '—'}
                </p>
              </td>

              <td className="max-w-60 px-5 py-3.5">
                <p className="truncate font-mono text-sm text-slate-200" title={event.path}>
                  <span className={cn('mr-2 font-semibold', METHOD_TONE[event.method] ?? 'text-slate-400')}>
                    {event.method}
                  </span>
                  {truncate(event.path, 36)}
                </p>
                {event.reasonSummary && (
                  <p dir="auto" className="truncate text-[11px] text-slate-500" title={event.reasonSummary}>
                    {event.reasonSummary}
                  </p>
                )}
              </td>

              <td className="px-5 py-3.5 text-sm text-slate-400">
                {event.server?.domain ?? '—'}
              </td>

              <td className="px-5 py-3.5">
                <RiskGauge score={event.riskScore} />
              </td>

              <td className="px-5 py-3.5">
                <DecisionBadge decision={event.decision} />
              </td>

              <td className="px-5 py-3.5">
                <ChallengeCell event={event} />
              </td>

              <td className="px-3 py-3.5 text-slate-600">
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-400" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------- Empty ---------- */}
      {!loading && events.length === 0 && (
        <EmptyState
          icon={ShieldQuestion}
          title="No security events found"
          description="Nothing matches the current filters. Events appear here once the Gateway starts processing traffic."
          action={emptyAction}
        />
      )}
    </div>
  )
}
