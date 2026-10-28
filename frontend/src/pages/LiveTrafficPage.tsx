// frontend/src/pages/LiveTrafficPage.tsx
// ==================================================================
// Zero Plus - Live Traffic Page
// صفحة مراقبة حركة المرور اللحظية (Real-time Traffic Monitoring)
// (مربوطة بـ backend/modules/events)
// ==================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ElementType } from 'react'
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  X,
} from 'lucide-react'

import { useToast } from '../components/ui/Toast'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  SelectInput,
  Skeleton,
  TextInput,
} from '../components/ui/kit'
import { parseApiError } from '../services/apiError'
import apiClient from '../services/api'
import { getSocket } from '../services/socket'
import type { SecurityEvent } from '../services/types'
import { cn, timeAgo } from '../utils/format'

// ==================================================================
// Types & Constants
// ==================================================================

type EventAction = 'ALLOW' | 'BLOCK' | 'CHALLENGE' | 'RATE_LIMIT' | 'MONITOR'

interface TrafficFilters {
  search: string
  action: EventAction | ''
  minRiskScore: string
}

const MAX_EVENTS_DISPLAY = 100

const ACTION_META: Record<EventAction, { label: string; color: string; icon: ElementType }> = {
  ALLOW: { label: 'Allowed', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  BLOCK: { label: 'Blocked', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20', icon: Ban },
  CHALLENGE: { label: 'Challenged', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: ShieldAlert },
  RATE_LIMIT: { label: 'محدد السرعة', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', icon: Activity },
  MONITOR: { label: 'مراقب', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', icon: Shield },
}

// ==================================================================
// Page Component
// ==================================================================

export default function LiveTrafficPage() {
  const toast = useToast()

  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLive, setIsLive] = useState(true)
  const [filters, setFilters] = useState<TrafficFilters>({
    search: '',
    action: '',
    minRiskScore: '',
  })

  const eventsCountRef = useRef(0)

  const stats = useMemo(() => {
    const total = events.length
    const blocked = events.filter((e) => e.action === 'BLOCK').length
    const challenged = events.filter((e) => e.action === 'CHALLENGE').length
    const avgRisk = total > 0 ? events.reduce((acc, curr) => acc + curr.riskScore, 0) / total : 0

    return { total, blocked, challenged, avgRisk: avgRisk.toFixed(1) }
  }, [events])

  const loadInitialEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await apiClient.get<{ success: boolean; events: SecurityEvent[] }>('/events', {
        params: { limit: 50, sortBy: 'createdAt', sortOrder: 'desc' },
      })
      
      setEvents(data.events)
      eventsCountRef.current = data.events.length
    } catch (err) {
      const { message } = parseApiError(err)
      setError(message)
      toast.error('Load failed', 'تعذر جلب بيانات حركة المرور الأولية')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadInitialEvents()
  }, [loadInitialEvents])

  useEffect(() => {
    if (!isLive) return

    const socket = getSocket()

    const handleNewEvent = (newEvent: SecurityEvent) => {
      if (filters.action && newEvent.action !== filters.action) return
      if (filters.minRiskScore && newEvent.riskScore < parseInt(filters.minRiskScore, 10)) return
      if (filters.search && !newEvent.ip.includes(filters.search) && !newEvent.path.includes(filters.search)) return

      setEvents((prev) => {
        if (prev.some((e) => e.id === newEvent.id)) return prev
        
        const updated = [newEvent, ...prev]
        return updated.slice(0, MAX_EVENTS_DISPLAY)
      })
    }

    socket.on('event:new', handleNewEvent)

    return () => {
      socket.off('event:new', handleNewEvent)
    }
  }, [isLive, filters])

  const handleFilterChange = (key: keyof TrafficFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const clearFilters = () => {
    setFilters({ search: '', action: '', minRiskScore: '' })
  }

  const hasActiveFilters = filters.search !== '' || filters.action !== '' || filters.minRiskScore !== ''

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filters.action && event.action !== filters.action) return false
      if (filters.minRiskScore && event.riskScore < parseInt(filters.minRiskScore, 10)) return false
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        return (
          event.ip.toLowerCase().includes(searchLower) ||
          event.path.toLowerCase().includes(searchLower) ||
          (event.country && event.country.toLowerCase().includes(searchLower))
        )
      }
      return true
    })
  }, [events, filters])

  return (
    <PageShell>
      <PageHeader
        icon={Activity}
        title="Live Traffic"
        subtitle="Watch inbound requests in real time with risk analysis."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={isLive ? 'primary' : 'ghost'}
              icon={isLive ? Pause : Play}
              onClick={() => setIsLive(!isLive)}
              className={isLive ? 'bg-emerald-500 hover:bg-emerald-400' : ''}
            >
              {isLive ? 'Pause stream' : 'Resume stream'}
            </Button>
            <Button
              icon={RefreshCw}
              loading={loading}
              onClick={() => void loadInitialEvents()}
              disabled={loading}
            >
              Refresh يدوي
            </Button>
          </div>
        }
      />

      {isLive && !loading && (
        <div className="zp-anim-scale-in mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400 w-fit">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium">Live stream active</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        <StatMini label="Total events" value={stats.total.toString()} icon={Activity} tone="indigo" />
        <StatMini label="Blocked" value={stats.blocked.toString()} icon={Ban} tone="rose" />
        <StatMini label="Challenged" value={stats.challenged.toString()} icon={ShieldAlert} tone="amber" />
        <StatMini label="Avg risk" value={stats.avgRisk} icon={AlertTriangle} tone="orange" />
      </div>

      <Card className="p-4 mb-6" delay={60}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <TextInput
              icon={Search}
              value={filters.search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleFilterChange('search', e.target.value)}
              placeholder="Search by IP, path, or country…"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:shrink-0">
            <SelectInput
              value={filters.action}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFilterChange('action', e.target.value as EventAction)}
              className="lg:w-44"
            >
              <option value="">All decisions</option>
              <option value="ALLOW" className="bg-slate-900">Allowed</option>
              <option value="BLOCK" className="bg-slate-900">Blocked</option>
              <option value="CHALLENGE" className="bg-slate-900">Challenged</option>
              <option value="RATE_LIMIT" className="bg-slate-900">محدد السرعة</option>
            </SelectInput>

            <SelectInput
              value={filters.minRiskScore}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFilterChange('minRiskScore', e.target.value)}
              className="lg:w-44"
            >
              <option value="">أي درجة خطورة</option>
              <option value="20" className="bg-slate-900">منخفضة (&gt; 20)</option>
              <option value="50" className="bg-slate-900">متوسطة (&gt; 50)</option>
              <option value="80" className="bg-slate-900">حرجة (&gt; 80)</option>
            </SelectInput>
          </div>

          {hasActiveFilters && (
            <Button icon={X} variant="ghost" onClick={clearFilters} className="shrink-0">
              Clear
            </Button>
          )}
        </div>
      </Card>

      {error && events.length === 0 ? (
        <Card>
          <ErrorState message={error} onRetry={() => void loadInitialEvents()} />
        </Card>
      ) : loading && events.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredEvents.length === 0 ? (
        <Card>
          <EmptyState
            icon={Activity}
            title={hasActiveFilters ? 'No توجد أحداث مطابقة للفلاتر' : 'No توجد حركة مرور حالياً'}
            description={
              hasActiveFilters
                ? 'جرب تغيير Filters أو Clearها لرؤية جميع الأحداث.'
                : 'سيتم عرض الطلبات الواردة هنا فور وصولها عند تفعيل البث المباشر.'
            }
            action={
              hasActiveFilters ? (
                <Button icon={X} onClick={clearFilters}>Clear Filters</Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event, index) => (
            <EventRow
              key={event.id}
              event={event}
              index={index}
              isNew={index === 0 && isLive}
            />
          ))}
        </div>
      )}

      {events.length >= MAX_EVENTS_DISPLAY && (
        <div className="mt-4 text-center text-xs text-slate-500">
          يتم عرض آخر {MAX_EVENTS_DISPLAY} حدث فقط للحفاظ على أداء المتصفح.
        </div>
      )}
    </PageShell>
  )
}

// ==================================================================
// Sub-Components
// ==================================================================

function StatMini({ label, value, icon: Icon, tone }: { label: string; value: string; icon: ElementType; tone: string }) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  }

  return (
    <div className={cn('zp-anim-fade-up rounded-xl border p-4', tones[tone])}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider opacity-80">{label}</p>
          <p className="mt-1 text-2xl font-bold text-white">{value}</p>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function EventRow({ event, index, isNew }: { event: SecurityEvent; index: number; isNew: boolean }) {
  const meta = ACTION_META[event.action as EventAction] || ACTION_META.ALLOW
  const ActionIcon = meta.icon

  return (
    <div
      className={cn(
        'zp-anim-fade-up group flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4 transition-all hover:border-white/15 hover:bg-white/5 sm:flex-row sm:items-center sm:justify-between',
        isNew && 'animate-in slide-in-from-top-2 fade-in duration-500 border-emerald-500/30 bg-emerald-500/5'
      )}
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
    >
      <div className="flex items-start gap-4">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', meta.color)}>
          <ActionIcon className="h-5 w-5" />
        </div>
        
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-white">{event.ip}</span>
            <span className="text-xs text-slate-500">•</span>
            <span className="truncate text-sm text-slate-300" title={event.path}>
              {event.method} {event.path}
            </span>
          </div>
          
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            {event.country && (
              <span className="flex items-center gap-1">
                <span>{getCountryFlag(event.country)}</span>
                <span>{event.country}</span>
              </span>
            )}
            <span>•</span>
            <span>{timeAgo(event.createdAt)}</span>
            {event.userAgent && (
              <>
                <span>•</span>
                <span className="max-w-[200px] truncate" title={event.userAgent}>
                  {event.userAgent}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 sm:justify-end sm:border-l sm:border-white/8 sm:pl-4">
        <div className="text-right">
          <p className="text-xs text-slate-500">درجة الخطورة</p>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  'h-full transition-all duration-500',
                  event.riskScore >= 80 ? 'bg-rose-500' : event.riskScore >= 50 ? 'bg-amber-500' : 'bg-emerald-500'
                )}
                style={{ width: `${event.riskScore}%` }}
              />
            </div>
            <span className={cn(
              'text-sm font-bold',
              event.riskScore >= 80 ? 'text-rose-400' : event.riskScore >= 50 ? 'text-amber-400' : 'text-emerald-400'
            )}>
              {event.riskScore}
            </span>
          </div>
        </div>

        <span className={cn(
          'shrink-0 rounded-full border px-3 py-1 text-xs font-medium',
          meta.color
        )}>
          {meta.label}
        </span>
      </div>
    </div>
  )
}

function getCountryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌍'
  const cc = code.toUpperCase()
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}