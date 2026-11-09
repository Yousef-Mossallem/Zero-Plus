// frontend/src/pages/reputation/EntryDrawer.tsx — تفاصيل الجهاز + سجل الاختبارات

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Lock, RotateCcw, ShieldCheck, ShieldOff, Unlock, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/Toast'
import { Badge, Button, Drawer, KeyValue, Skeleton } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { listChallenges, type ChallengeLog, type ReputationEntry } from '../../services/reputationService'
import { formatDateTime, formatNumber, timeAgo } from '../../utils/format'
import { BAND_META, BanBadge, ScorePips, isCurrentlyBanned } from './shared'
import type { ActionKind } from './ActionModal'

// ==================================================================
// Entry Drawer (التفاصيل + سجل الاختبارات)
// ==================================================================

export function EntryDrawer({
  entry,
  canAct,
  busy,
  onClose,
  onAction,
  onToggleAllow,
}: {
  entry: ReputationEntry | null
  canAct: boolean
  busy: boolean
  onClose: () => void
  onAction: (kind: ActionKind) => void
  onToggleAllow: () => void
}) {
  const { t } = useTranslation('reputation')
  const toast = useToast()
  const navigate = useNavigate()
  const [challenges, setChallenges] = useState<ChallengeLog[]>([])
  const [loading, setLoading] = useState(false)

  const entryId = entry?.id
  useEffect(() => {
    if (!entryId) return
    let cancelled = false
    setLoading(true)
    setChallenges([])
    listChallenges(entryId, { limit: 10 })
      .then((res) => {
        if (!cancelled) setChallenges(res.data)
      })
      .catch((err) => {
        if (!cancelled) toast.error(t('toast.challengeFailed'), parseApiError(err).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entryId, t, toast])

  const banned = entry ? isCurrentlyBanned(entry) : false

  return (
    <Drawer
      open={entry !== null}
      onClose={onClose}
      title={entry?.ipAddress ?? ''}
      subtitle={entry ? t('drawer.firstSeen', { time: formatDateTime(entry.firstSeenAt) }) : undefined}
    >
      {entry && (
        <div className="space-y-6">
          {/* ---------- Score + status ---------- */}
          <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
            <div className="flex items-center justify-between gap-3">
              <ScorePips score={entry.score} band={entry.scoreBand} />
              <Badge tone={BAND_META[entry.scoreBand].tone} dot>
                {BAND_META[entry.scoreBand].label}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <BanBadge entry={entry} />
              {entry.isAllowlisted && <Badge tone="emerald">{t('filters.trusted')}</Badge>}
              {entry.isKnownBotnet && <Badge tone="rose">{t('filters.botnet')}</Badge>}
              {entry.isManualBan && <Badge tone="slate">{t('filters.manualBan')}</Badge>}
            </div>
            {entry.banReason && (
              <p dir="auto" className="mt-3 text-sm text-slate-400">
                <span className="text-slate-500">{t('drawer.banReason')}</span>
                {entry.banReason}
              </p>
            )}
          </div>

          {/* ---------- Actions ---------- */}
          <div className="grid grid-cols-2 gap-2">
            {canAct ? (
              <>
                {banned ? (
                  <Button variant="success" icon={Unlock} disabled={busy} onClick={() => onAction('unban')}>
                    {t('drawer.liftBan')}
                  </Button>
                ) : (
                  <Button variant="danger" icon={Ban} disabled={busy} onClick={() => onAction('ban')}>
                    {t('drawer.banDevice')}
                  </Button>
                )}
                <Button
                  icon={entry.isAllowlisted ? ShieldOff : ShieldCheck}
                  disabled={busy}
                  onClick={onToggleAllow}
                >
                  {entry.isAllowlisted ? t('drawer.removeTrust') : t('drawer.markTrusted')}
                </Button>
                <Button icon={RotateCcw} disabled={busy} onClick={() => onAction('reset')}>
                  {t('drawer.resetScore')}
                </Button>
              </>
            ) : (
              <p className="col-span-2 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-500">
                <Lock className="me-2 inline h-4 w-4" />
                {t('drawer.readOnly')}
              </p>
            )}
            <Button
              icon={ExternalLink}
              onClick={() => navigate(`/security-events?entry=${encodeURIComponent(entry.id)}`)}
            >
              {t('drawer.viewEvents')}
            </Button>
          </div>

          {/* ---------- Details ---------- */}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              {t('drawer.activity')}
            </h4>
            <KeyValue label={t('drawer.totalRequests')}>{formatNumber(entry.totalRequests)}</KeyValue>
            <KeyValue label={t('drawer.failedChecks')}>{entry.failedChecksCount}</KeyValue>
            <KeyValue label={t('drawer.successfulChecks')}>{entry.successfulChecks}</KeyValue>
            <KeyValue label={t('drawer.avgRate')}>
              {entry.avgRequestRate !== null ? `${entry.avgRequestRate.toFixed(1)} /s` : undefined}
            </KeyValue>
            <KeyValue label={t('drawer.lastSeen')}>{formatDateTime(entry.lastSeenAt)}</KeyValue>
            <KeyValue label={t('drawer.lastFailed')}>{formatDateTime(entry.lastFailedAt)}</KeyValue>
            <KeyValue label={t('drawer.lastPath')} mono>{entry.lastPath}</KeyValue>
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              {t('drawer.identity')}
            </h4>
            <KeyValue label={t('drawer.ipType')}>{entry.ipType.replace('_', ' / ')}</KeyValue>
            <KeyValue label={t('drawer.country')}>{entry.countryCode}</KeyValue>
            <KeyValue label={t('drawer.asn')}>{entry.asn ?? undefined}</KeyValue>
            <KeyValue label={t('drawer.org')}>{entry.asOrg}</KeyValue>
            <KeyValue label={t('drawer.fingerprint')} mono>{entry.deviceFingerprint}</KeyValue>
            <KeyValue label={t('drawer.ja3')} mono>{entry.ja3Fingerprint}</KeyValue>
            <KeyValue label={t('drawer.ja4')} mono>{entry.ja4Fingerprint}</KeyValue>
            <KeyValue label={t('drawer.userAgent')} mono>{entry.lastUserAgent}</KeyValue>
          </section>

          {/* ---------- Challenge history ---------- */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              {t('drawer.challenges')}
            </h4>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full rounded-xl" />
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
            ) : challenges.length === 0 ? (
              <p className="text-sm text-slate-600">{t('drawer.noChallenges')}</p>
            ) : (
              <ul className="space-y-2">
                {challenges.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/2 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200">{c.challengeType.replaceAll('_', ' ')}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {timeAgo(c.createdAt)}
                        {c.durationMs !== null ? ` · ${c.durationMs} ms` : ''}
                        {c.failureReason ? ` · ${c.failureReason}` : ''}
                      </p>
                    </div>
                    <Badge tone={c.passed ? 'emerald' : 'rose'}>{c.passed ? t('drawer.passed') : t('drawer.failed')}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
