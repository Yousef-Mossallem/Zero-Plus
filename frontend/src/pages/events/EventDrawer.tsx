// frontend/src/pages/events/EventDrawer.tsx — تفاصيل الحدث (Drawer جانبي)

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, ExternalLink } from 'lucide-react'
import RiskGauge from '../../components/RiskGauge'
import { useToast } from '../../components/ui/Toast'
import { Badge, Button, DecisionBadge, Drawer, KeyValue, Skeleton } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { getEventById, type SecurityEvent, type SecurityEventDetail } from '../../services/eventsService'
import { formatDateTime } from '../../utils/format'


// ==================================================================
// Event Details Drawer
// ==================================================================

export function EventDrawer({
  event,
  onClose,
}: {
  event: SecurityEvent | null
  onClose: () => void
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<SecurityEventDetail | null>(null)
  const [loading, setLoading] = useState(false)

  // بنجيب التفاصيل الكاملة (فيها reputationEntry) كل ما يتغير الحدث المختار
  const eventId = event?.id
  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    setDetail(null)
    setLoading(true)

    getEventById(eventId)
      .then((data) => {
        if (!cancelled) setDetail(data)
      })
      .catch((err) => {
        if (!cancelled) toast.error('Failed to load event details', parseApiError(err).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // toast ثابت (useMemo في الـ Provider)
  }, [eventId, toast])

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Copy failed', 'Your browser blocked clipboard access')
    }
  }

  // الصف اللي في الجدول كافي للعرض المبدئي لحد ما التفاصيل توصل
  const e = detail ?? event
  const rep = detail?.reputationEntry

  return (
    <Drawer
      open={event !== null}
      onClose={onClose}
      title="Event details"
      subtitle={e ? formatDateTime(e.createdAt) : undefined}
    >
      {e && (
        <div className="space-y-6">
          {/* ---------- Hero: الخطورة + القرار ---------- */}
          <div className="flex items-center gap-5 rounded-2xl border border-white/8 bg-white/3 p-5">
            <RiskGauge score={e.riskScore} variant="ring" />
            <div className="min-w-0 space-y-2">
              <DecisionBadge decision={e.decision} />
              {e.reasonSummary && (
                <p dir="auto" className="text-sm leading-relaxed text-slate-300">
                  {e.reasonSummary}
                </p>
              )}
            </div>
          </div>

          {/* ---------- Request ---------- */}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Request
            </h4>
            <KeyValue label="IP address" mono>
              <span className="inline-flex items-center gap-2">
                {e.ipAddress}
                <button
                  type="button"
                  onClick={() => copy(e.ipAddress, 'IP')}
                  className="text-slate-500 hover:text-cyan-300"
                  aria-label="Copy IP"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </span>
            </KeyValue>
            <KeyValue label="Method">{e.method}</KeyValue>
            <KeyValue label="Path" mono>
              {e.path}
            </KeyValue>
            <KeyValue label="Server">{e.server?.domain}</KeyValue>
            <KeyValue label="Request ID" mono>
              {e.requestId}
            </KeyValue>
            <KeyValue label="Referer">{e.referer}</KeyValue>
            <KeyValue label="User agent" mono>
              {e.userAgent}
            </KeyValue>
          </section>

          {/* ---------- Network ---------- */}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Network
            </h4>
            <KeyValue label="Country">{e.countryCode}</KeyValue>
            <KeyValue label="ASN">{e.asn ?? undefined}</KeyValue>
            <KeyValue label="IP type">{e.ipType?.replace('_', ' / ')}</KeyValue>
          </section>

          {/* ---------- Detection ---------- */}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Detection
            </h4>
            <KeyValue label="Decided at stage">{e.decidedAtStage?.replaceAll('_', ' ')}</KeyValue>
            <KeyValue label="Processing time">
              {e.processingTimeMs !== null ? `${e.processingTimeMs} ms` : undefined}
            </KeyValue>
            <KeyValue label="AI anomaly score">
              {e.anomalyScore !== null ? e.anomalyScore.toFixed(2) : undefined}
            </KeyValue>
            <KeyValue label="AI confidence">
              {e.confidence !== null ? `${Math.round(e.confidence * 100)}%` : undefined}
            </KeyValue>
            <KeyValue label="Challenge">
              {e.isChallenged ? (
                <span className="inline-flex items-center gap-2">
                  {e.challengeType?.replaceAll('_', ' ')}
                  {e.challengePassed === true && <Badge tone="emerald">Passed</Badge>}
                  {e.challengePassed === false && <Badge tone="rose">Failed</Badge>}
                </span>
              ) : (
                'Not challenged'
              )}
            </KeyValue>
          </section>

          {/* ---------- Reason details (JSON) ---------- */}
          {e.reasonDetails && Object.keys(e.reasonDetails).length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
                Signals & reason details
              </h4>
              <pre
                dir="ltr"
                className="max-h-64 overflow-auto rounded-xl border border-white/8 bg-black/30 p-4 text-xs leading-relaxed text-slate-300"
              >
                {JSON.stringify(e.reasonDetails, null, 2)}
              </pre>
            </section>
          )}

          {/* ---------- Reputation ---------- */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Device reputation
            </h4>
            {loading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : rep ? (
              <div className="rounded-xl border border-white/8 bg-white/3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm text-white">{rep.ipAddress}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Score {rep.score}/10 · {rep.ipType.replace('_', ' / ')}
                      {rep.countryCode ? ` · ${rep.countryCode}` : ''}
                    </p>
                  </div>
                  <Badge
                    tone={rep.banStatus === 'NONE' ? 'emerald' : 'rose'}
                    dot
                  >
                    {rep.banStatus === 'NONE' ? 'Not banned' : rep.banStatus}
                  </Badge>
                </div>
                <Button
                  className="mt-3 w-full"
                  size="sm"
                  icon={ExternalLink}
                  onClick={() => navigate(`/reputation?search=${encodeURIComponent(rep.ipAddress)}`)}
                >
                  Open in Reputation
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No reputation entry linked to this event.</p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
