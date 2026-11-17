// frontend/src/pages/dashboard/ServersPanel.tsx
// ==================================================================
// ملخص سيرفرات الشركة من GET /dashboard/servers
// بيعرض: الحالة • الحمل • السعة الآمنة (safeRequestsPerSecond) • توصية الـ Probe
//         • أحداث/محظور آخر ساعة • آخر فحص
// الضغط على سيرفر بيفتح صفحة السيرفرات
// ==================================================================

import { useNavigate } from 'react-router-dom'
import { Gauge, Server as ServerIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, ErrorState, Skeleton, type Tone } from '../../components/ui/kit'
import type { ServerSummaryItem, ServersSummaryData } from '../../services/dashboardService'
import { CONFIDENCE_LABEL, REC_META, formatRps } from '../../utils/serverMeta'
import { cn, formatNumber, timeAgo } from '../../utils/format'
import type { Section } from './useDashboardData'

const STATUS_TONE: Record<string, Tone> = {
  ONLINE: 'emerald',
  DEGRADED: 'amber',
  OFFLINE: 'rose',
  PENDING: 'slate',
  MAINTENANCE: 'indigo',
}

function ServerRow({ s, i }: { s: ServerSummaryItem; i: number }) {
  const { t } = useTranslation(['dashboard', 'servers'])
  const navigate = useNavigate()
  const rec = s.probeRecommendation ? REC_META[s.probeRecommendation] : undefined
  const load = s.currentLoadPercent
  const loadColor = load === null ? '' : load >= 85 ? 'bg-rose-500' : load >= 60 ? 'bg-amber-400' : 'bg-emerald-400'

  return (
    <li
      onClick={() => navigate('/servers')}
      style={{ animationDelay: `${i * 50}ms` }}
      className="zp-anim-fade-up cursor-pointer rounded-xl border border-white/6 bg-white/2 p-4 hover:border-cyan-400/25 hover:bg-white/4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-cyan-300">
            <ServerIcon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{s.domain}</p>
            <p className="text-[11px] text-slate-500">
              {s.mode === 'PROTECT' ? t('servers.protect') : t('servers.monitor')} · {t('servers.checked', { time: timeAgo(s.lastHealthCheckAt) })}
            </p>
          </div>
        </div>
        <Badge tone={STATUS_TONE[s.status] ?? 'slate'} dot>
          {t(`servers:status.${s.status}` as never) || s.status}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <p className="text-slate-500">{t('servers.safeCapacity')}</p>
          <p className="mt-0.5 flex items-center gap-1 font-semibold text-white">
            <Gauge className="h-3.5 w-3.5 text-cyan-400" />
            {formatRps(s.safeRequestsPerSecond)}
          </p>
        </div>
        <div>
          <p className="text-slate-500">{t('servers.quality')}</p>
          <div className="mt-0.5">
            {rec ? (
              <Badge tone={rec.tone} {...(s.probeConfidence && { className: 'cursor-help' })}>
                {rec.label}
              </Badge>
            ) : (
              <span className="text-slate-600">{s.lastProbeAt ? '—' : t('servers.notMeasured')}</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-slate-500">{t('servers.lastHour')}</p>
          <p className="mt-0.5 font-semibold text-white">
            {formatNumber(s.eventsLastHour)}{' '}
            <span className="font-normal text-rose-300">
              {t('servers.blocked', { count: formatNumber(s.blockedLastHour) })}
            </span>
          </p>
        </div>
        <div>
          <p className="text-slate-500">{t('servers.load')}</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8">
            {load !== null && <div className={cn('zp-anim-bar h-full rounded-full', loadColor)} style={{ width: `${Math.min(100, load)}%` }} />}
          </div>
          <p className="mt-0.5 text-slate-400">{load !== null ? `${load.toFixed(0)}%` : '—'}</p>
        </div>
      </div>
      {s.probeConfidence && (
        <p className="mt-2 text-[11px] text-slate-600">{CONFIDENCE_LABEL[s.probeConfidence] ?? s.probeConfidence}</p>
      )}
    </li>
  )
}

export default function ServersPanel({
  section,
  onRetry,
}: {
  section: Section<ServersSummaryData>
  onRetry: () => void
}) {
  const { t } = useTranslation('dashboard')
  const servers = section.data?.servers ?? []
  const totals = section.data?.totals

  return (
    <Card className="p-5" delay={200}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{t('servers.title')}</h3>
        {totals && (
          <span className="text-xs text-slate-500">
            {totals.online}/{totals.count} online
          </span>
        )}
      </div>

      {section.loading && !section.data ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : section.error && !section.data ? (
        <ErrorState message={section.error} onRetry={onRetry} />
      ) : servers.length === 0 ? (
        <EmptyState icon={ServerIcon} title={t('servers.empty')} description="" />
      ) : (
        <ul className={cn('space-y-3', section.loading && 'opacity-60')}>
          {servers.map((s, i) => (
            <ServerRow key={s.id} s={s} i={i} />
          ))}
        </ul>
      )}
    </Card>
  )
}
