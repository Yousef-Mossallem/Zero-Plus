// frontend/src/pages/events/EventDrawer.tsx — تفاصيل الحدث (Drawer جانبي)
// i18n: كل العناوين والحقول من events.drawer. القيم التقنية (IP / مسار / User agent /
// JSON) بتفضل LTR، وقيمة banStatus مترجمة لو معروفة.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('events')

  // قيم جاية من الباك (نوع IP / حالة الحظر): مفاتيحها ديناميكية مع defaultValue
  const ts = t as unknown as (key: string, opts?: object) => string

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
        if (!cancelled) toast.error(ts('toast.detailsFailed'), parseApiError(err).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // toast ثابت (useMemo في الـ Provider)، و t ما بنحطهاش عشان تغيير اللغة ما يعيدش الطلب
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, toast])

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('toast.copied', { label }))
    } catch {
      toast.error(t('toast.copyFailed'), t('toast.copyBlocked'))
    }
  }

  const ipTypeLabel = (type: string) => ts(`ipTypes.${type}`, { defaultValue: type.replace('_', ' / ') })

  // الصف اللي في الجدول كافي للعرض المبدئي لحد ما التفاصيل توصل
  const e = detail ?? event
  const rep = detail?.reputationEntry

  const sectionTitle = 'mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80'

  return (
    <Drawer
      open={event !== null}
      onClose={onClose}
      title={t('drawer.title')}
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
            <h4 className={sectionTitle}>{t('drawer.sections.request')}</h4>
            <KeyValue label={t('drawer.fields.ipAddress')} mono>
              <span className="inline-flex items-center gap-2">
                {e.ipAddress}
                <button
                  type="button"
                  onClick={() => copy(e.ipAddress, 'IP')}
                  className="text-slate-500 hover:text-cyan-300"
                  aria-label={t('drawer.copyIp')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </span>
            </KeyValue>
            <KeyValue label={t('drawer.fields.method')}>{e.method}</KeyValue>
            <KeyValue label={t('drawer.fields.path')} mono>
              {e.path}
            </KeyValue>
            <KeyValue label={t('drawer.fields.server')}>{e.server?.domain}</KeyValue>
            <KeyValue label={t('drawer.fields.requestId')} mono>
              {e.requestId}
            </KeyValue>
            <KeyValue label={t('drawer.fields.referer')}>{e.referer}</KeyValue>
            <KeyValue label={t('drawer.fields.userAgent')} mono>
              {e.userAgent}
            </KeyValue>
          </section>

          {/* ---------- Network ---------- */}
          <section>
            <h4 className={sectionTitle}>{t('drawer.sections.network')}</h4>
            <KeyValue label={t('drawer.fields.country')}>{e.countryCode}</KeyValue>
            <KeyValue label={t('drawer.fields.asn')}>{e.asn ?? undefined}</KeyValue>
            <KeyValue label={t('drawer.fields.ipType')}>{e.ipType ? ipTypeLabel(e.ipType) : undefined}</KeyValue>
          </section>

          {/* ---------- Detection ---------- */}
          <section>
            <h4 className={sectionTitle}>{t('drawer.sections.detection')}</h4>
            <KeyValue label={t('drawer.fields.stage')}>{e.decidedAtStage?.replaceAll('_', ' ')}</KeyValue>
            <KeyValue label={t('drawer.fields.processing')}>
              {e.processingTimeMs !== null ? `${e.processingTimeMs} ms` : undefined}
            </KeyValue>
            <KeyValue label={t('drawer.fields.anomaly')}>
              {e.anomalyScore !== null ? e.anomalyScore.toFixed(2) : undefined}
            </KeyValue>
            <KeyValue label={t('drawer.fields.confidence')}>
              {e.confidence !== null ? `${Math.round(e.confidence * 100)}%` : undefined}
            </KeyValue>
            <KeyValue label={t('drawer.fields.challenge')}>
              {e.isChallenged ? (
                <span className="inline-flex items-center gap-2">
                  {e.challengeType?.replaceAll('_', ' ')}
                  {e.challengePassed === true && <Badge tone="emerald">{t('table.passed')}</Badge>}
                  {e.challengePassed === false && <Badge tone="rose">{t('table.failed')}</Badge>}
                </span>
              ) : (
                t('drawer.fields.notChallenged')
              )}
            </KeyValue>
          </section>

          {/* ---------- Reason details (JSON) ---------- */}
          {e.reasonDetails && Object.keys(e.reasonDetails).length > 0 && (
            <section>
              <h4 className={sectionTitle.replace('mb-1', 'mb-2')}>{t('drawer.sections.signals')}</h4>
              <pre
                dir="ltr"
                className="max-h-64 overflow-auto rounded-xl border border-white/8 bg-black/30 p-4 text-start text-xs leading-relaxed text-slate-300"
              >
                {JSON.stringify(e.reasonDetails, null, 2)}
              </pre>
            </section>
          )}

          {/* ---------- Reputation ---------- */}
          <section>
            <h4 className={sectionTitle.replace('mb-1', 'mb-2')}>{t('drawer.sections.reputation')}</h4>
            {loading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : rep ? (
              <div className="rounded-xl border border-white/8 bg-white/3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p dir="ltr" className="text-start font-mono text-sm text-white">{rep.ipAddress}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {t('drawer.rep.score', { score: rep.score, type: ipTypeLabel(rep.ipType) })}
                      {rep.countryCode ? ` · ${rep.countryCode}` : ''}
                    </p>
                  </div>
                  <Badge
                    tone={rep.banStatus === 'NONE' ? 'emerald' : 'rose'}
                    dot
                  >
                    {rep.banStatus === 'NONE'
                      ? t('drawer.rep.notBanned')
                      : ts(`drawer.banStatus.${rep.banStatus}`, { defaultValue: rep.banStatus })}
                  </Badge>
                </div>

                <Button
                  className="mt-3 w-full"
                  size="sm"
                  icon={ExternalLink}
                  onClick={() => navigate(`/reputation?search=${encodeURIComponent(rep.ipAddress)}`)}
                >
                  {t('drawer.rep.open')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">{t('drawer.rep.none')}</p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
