// frontend/src/pages/reputation/EntryDrawer.tsx — تفاصيل الجهاز + سجل الاختبارات

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Lock, RotateCcw, ShieldCheck, ShieldOff, Unlock, ExternalLink } from 'lucide-react'
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
        if (!cancelled) toast.error('Failed to load challenge history', parseApiError(err).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entryId, toast])

  const banned = entry ? isCurrentlyBanned(entry) : false

  return (
    <Drawer
      open={entry !== null}
      onClose={onClose}
      title={entry?.ipAddress ?? ''}
      subtitle={entry ? `First seen ${formatDateTime(entry.firstSeenAt)}` : undefined}
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
              {entry.isAllowlisted && <Badge tone="emerald">Trusted</Badge>}
              {entry.isKnownBotnet && <Badge tone="rose">Known botnet</Badge>}
              {entry.isManualBan && <Badge tone="slate">Manual ban</Badge>}
            </div>
            {entry.banReason && (
              <p dir="auto" className="mt-3 text-sm text-slate-400">
                <span className="text-slate-500">Ban reason: </span>
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
                    Lift ban
                  </Button>
                ) : (
                  <Button variant="danger" icon={Ban} disabled={busy} onClick={() => onAction('ban')}>
                    Ban device
                  </Button>
                )}
                <Button
                  icon={entry.isAllowlisted ? ShieldOff : ShieldCheck}
                  disabled={busy}
                  onClick={onToggleAllow}
                >
                  {entry.isAllowlisted ? 'Remove trust' : 'Mark trusted'}
                </Button>
                <Button icon={RotateCcw} disabled={busy} onClick={() => onAction('reset')}>
                  Reset score
                </Button>
              </>
            ) : (
              <p className="col-span-2 rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-500">
                <Lock className="mr-2 inline h-4 w-4" />
                Your role has read-only access to reputation.
              </p>
            )}
            <Button
              icon={ExternalLink}
              onClick={() => navigate(`/security-events?entry=${encodeURIComponent(entry.id)}`)}
            >
              View events
            </Button>
          </div>

          {/* ---------- Details ---------- */}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Activity
            </h4>
            <KeyValue label="Total requests">{formatNumber(entry.totalRequests)}</KeyValue>
            <KeyValue label="Failed checks">{entry.failedChecksCount}</KeyValue>
            <KeyValue label="Successful checks">{entry.successfulChecks}</KeyValue>
            <KeyValue label="Avg request rate">
              {entry.avgRequestRate !== null ? `${entry.avgRequestRate.toFixed(1)} /s` : undefined}
            </KeyValue>
            <KeyValue label="Last seen">{formatDateTime(entry.lastSeenAt)}</KeyValue>
            <KeyValue label="Last failed">{formatDateTime(entry.lastFailedAt)}</KeyValue>
            <KeyValue label="Last path" mono>{entry.lastPath}</KeyValue>
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Identity
            </h4>
            <KeyValue label="IP type">{entry.ipType.replace('_', ' / ')}</KeyValue>
            <KeyValue label="Country">{entry.countryCode}</KeyValue>
            <KeyValue label="ASN">{entry.asn ?? undefined}</KeyValue>
            <KeyValue label="Organization">{entry.asOrg}</KeyValue>
            <KeyValue label="Device fingerprint" mono>{entry.deviceFingerprint}</KeyValue>
            <KeyValue label="JA3" mono>{entry.ja3Fingerprint}</KeyValue>
            <KeyValue label="JA4" mono>{entry.ja4Fingerprint}</KeyValue>
            <KeyValue label="User agent" mono>{entry.lastUserAgent}</KeyValue>
          </section>

          {/* ---------- Challenge history ---------- */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Recent challenges
            </h4>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full rounded-xl" />
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
            ) : challenges.length === 0 ? (
              <p className="text-sm text-slate-600">No challenges recorded for this device.</p>
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
                    <Badge tone={c.passed ? 'emerald' : 'rose'}>{c.passed ? 'Passed' : 'Failed'}</Badge>
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
