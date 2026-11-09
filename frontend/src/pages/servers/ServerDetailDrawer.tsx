// frontend/src/pages/servers/ServerDetailDrawer.tsx
// ==================================================================
// Server details + capacity measurement (Origin Probe)
//   GET  /servers/:id       → full details including probe fields
//   POST /servers/:id/probe → 202 immediately (OWNER/ADMIN); the result
//                             arrives ~2 minutes later via Socket (server:status)
//                             or a fresh GET
//   Error cases:
//     409 OWNERSHIP_REQUIRED → verify domain ownership first (button opens DNS setup)
//     429 PROBE_TOO_FREQUENT → countdown from Retry-After / details.retryAfterSec
//     404 SERVER_NOT_FOUND   → server was deleted or isn't in this organization
//
// The parent passes a server that is kept fresh by the Socket. When
// lastProbeAt becomes newer than it was when we started, the measurement is
// done. While measuring we also poll GET /servers/:id every 15s as a
// fallback in case the Socket event is missed.
//
// i18n: النصوص من servers.drawer / servers.toast. الرسائل داخل الـ effects بتتطلب
// عن طريق tRef عشان تغيير اللغة ما يعيدش تشغيل الـ effects (مفيش طلبات زيادة).
// ==================================================================

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, AlertTriangle, Gauge, Globe, Loader2, Radar, Timer } from 'lucide-react'
import { useToast } from '../../components/ui/Toast'
import { Badge, Button, Drawer, KeyValue, Skeleton } from '../../components/ui/kit'
import { getApiErrorInfo, getServer, requestProbe, type Server } from '../../services/serversService'
import { REC_META, formatRps, getConfidenceLabel } from '../../utils/serverMeta'
import { formatDateTime, formatMs, timeAgo } from '../../utils/format'
import { STATUS_META } from './shared'

/** The backend says ~2 minutes; we stay in "Measuring…" for up to 150 seconds */
const PROBE_WAIT_MS = 150_000
/** Fallback polling while measuring (in case the Socket event is missed) */
const PROBE_POLL_MS = 15_000

/** Is `value` a later timestamp than `base`? (base = null means "never measured") */
function isNewer(value: string | null | undefined, base: string | null): boolean {
  if (!value) return false
  if (!base) return true
  return Date.parse(value) > Date.parse(base)
}

export default function ServerDetailDrawer({
  server,
  canManage,
  onClose,
  onOpenDns,
  onServerUpdated,
}: {
  /** The server from the list (kept fresh by the Socket) */
  server: Server | null
  canManage: boolean
  onClose: () => void
  onOpenDns: (server: Server) => void
  onServerUpdated: (server: Server) => void
}) {
  const toast = useToast()
  const { t } = useTranslation('servers')
  const [full, setFull] = useState<Server | null>(null)
  const [loading, setLoading] = useState(false)
  const [probing, setProbing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [needsOwnership, setNeedsOwnership] = useState(false)

  // Latest callbacks / values in refs so effects don't re-run (or loop) because of them
  const cb = useRef({ toast, onClose, onServerUpdated, t })
  const serverRef = useRef<Server | null>(server)
  useEffect(() => {
    cb.current = { toast, onClose, onServerUpdated, t }
    serverRef.current = server
  })

  // lastProbeAt at the moment the measurement started
  const probeStartedWith = useRef<string | null>(null)
  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const id = server?.id
  const lastProbeAt = server?.lastProbeAt ?? null
  const updatedAt = server?.updatedAt

  const clearProbeTimer = () => {
    if (probeTimer.current) {
      clearTimeout(probeTimer.current)
      probeTimer.current = null
    }
  }

  // ---------------- Reset when the opened server changes or the drawer closes ----------------
  useEffect(() => {
    setProbing(false)
    setStarting(false)
    setNeedsOwnership(false)
    setCooldown(0)
    probeStartedWith.current = null
    clearProbeTimer()
    if (!id) setFull(null)
    return clearProbeTimer
  }, [id])

  // ---------------- Fetch details (on open + whenever the server updates) ----------------
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)

    getServer(id)
      .then((data) => {
        if (cancelled) return
        setFull(data)
        // Only push upward when the fetched copy is actually newer (prevents update loops)
        const current = serverRef.current
        if (!current || Date.parse(data.updatedAt) > Date.parse(current.updatedAt)) {
          cb.current.onServerUpdated(data)
        }
      })
      .catch((err) => {
        if (cancelled) return
        const info = getApiErrorInfo(err)
        if (info.status === 404) {
          cb.current.toast.error(cb.current.t('toast.notFound'), cb.current.t('toast.notFoundDesc'))
          cb.current.onClose()
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, lastProbeAt, updatedAt])

  // ---------------- Measurement finished? ----------------
  const fullForId = full && full.id === id ? full : null
  const fullProbeAt = fullForId?.lastProbeAt ?? null

  useEffect(() => {
    if (!probing) return
    const base = probeStartedWith.current
    if (isNewer(lastProbeAt, base) || isNewer(fullProbeAt, base)) {
      clearProbeTimer()
      setProbing(false)
      cb.current.toast.success(cb.current.t('toast.measureDone'), serverRef.current?.domain)
    }
  }, [probing, lastProbeAt, fullProbeAt])

  // ---------------- Fallback polling while measuring ----------------
  useEffect(() => {
    if (!probing || !id) return
    let cancelled = false

    const timer = setInterval(() => {
      getServer(id)
        .then((data) => {
          if (cancelled) return
          setFull(data)
          cb.current.onServerUpdated(data)
        })
        .catch(() => {
          /* ignore: the next tick or the Socket will catch up */
        })
    }, PROBE_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [probing, id])

  // ---------------- 429 countdown ----------------
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // Show whichever copy is newer: the Socket-updated list item or the full fetch
  const s: Server | null =
    server && fullForId
      ? Date.parse(server.updatedAt) > Date.parse(fullForId.updatedAt)
        ? server
        : fullForId
      : (server ?? fullForId)

  // ---------------- Re-measure ----------------
  const startProbe = async () => {
    if (!s) return
    setStarting(true)
    setNeedsOwnership(false)
    probeStartedWith.current = s.lastProbeAt

    try {
      const res = await requestProbe(s.id)
      // 202: measurement started, the result arrives later
      setProbing(true)
      toast.info(t('toast.measureStarted'), res.message)

      clearProbeTimer()
      probeTimer.current = setTimeout(() => {
        setProbing(false)
        cb.current.toast.info(cb.current.t('toast.measureSlow'), cb.current.t('toast.measureSlowDesc'))
      }, PROBE_WAIT_MS)
    } catch (err) {
      const { status, code, message, retryAfterSec } = getApiErrorInfo(err)
      if (status === 409 || code === 'OWNERSHIP_REQUIRED') {
        setNeedsOwnership(true)
        toast.info(t('toast.verifyFirst'), message)
      } else if (status === 429 || code === 'PROBE_TOO_FREQUENT') {
        setCooldown(retryAfterSec ?? 60)
        toast.info(t('toast.waitGeneric'), message)
      } else if (status === 404) {
        toast.error(t('toast.notFound'), message)
        onClose()
      } else {
        toast.error(t('toast.measureFailed'), message)
      }
    } finally {
      setStarting(false)
    }
  }

  const rec = s?.probeRecommendation ? REC_META[s.probeRecommendation] : undefined
  const unverified = s ? !s.dnsVerified : false
  const neverMeasured = s ? s.lastProbeAt === null : false
  const inMaintenance = s?.status === 'MAINTENANCE'

  const sectionTitle = 'mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80'
  const yesNo = (v: boolean) => (v ? t('drawer.yes') : t('drawer.no'))

  return (
    <Drawer
      open={server !== null}
      onClose={onClose}
      title={s?.domain ?? t('drawer.fallbackTitle')}
      subtitle={
        s ? (
          <>
            <span dir="ltr" className="inline-block">
              {s.originIp}:{s.originPort}
            </span>{' '}
            · {t(`mode.${s.mode}`)}
          </>
        ) : undefined
      }
    >
      {s && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_META[s.status].tone} dot>
              {STATUS_META[s.status].label}
            </Badge>
            <Badge tone={s.dnsVerified ? 'emerald' : 'amber'}>
              {s.dnsVerified ? t('drawer.verified') : t('drawer.notVerified')}
            </Badge>
            <Badge tone={s.gatewayReachable ? 'emerald' : 'slate'}>
              {s.gatewayReachable ? t('drawer.routingOk') : t('drawer.routingPending')}
            </Badge>
          </div>

          {/* ---------- Safe capacity (primary number) ---------- */}
          <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Gauge className="h-3.5 w-3.5 text-cyan-400" />
              {t('drawer.safeCapacity')}
            </p>

            {probing ? (
              <div className="mt-3 flex items-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-cyan-300" />
                <div>
                  <p className="text-lg font-semibold text-white">{t('drawer.measuring')}</p>
                  <p className="text-xs text-slate-500">{t('drawer.measuringDesc')}</p>
                </div>
              </div>
            ) : loading && !fullForId && s.safeRequestsPerSecond === null ? (
              <Skeleton className="mt-3 h-10 w-40" />
            ) : s.safeRequestsPerSecond !== null ? (
              <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                <p className="zp-anim-fade-up text-4xl font-bold tracking-tight text-white">
                  {s.safeRequestsPerSecond.toLocaleString('en-US')}
                  <span className="ms-1.5 text-base font-medium text-slate-500">req/s</span>
                </p>
                {rec && <Badge tone={rec.tone}>{rec.label}</Badge>}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                {neverMeasured ? t('drawer.notMeasured') : t('drawer.noUsable')}
              </p>
            )}
          </div>

          {/* ---------- Measurement details ---------- */}
          <section>
            <h4 className={sectionTitle}>{t('drawer.sections.measurement')}</h4>
            <KeyValue label={t('drawer.fields.maxRate')}>{formatRps(s.maxRequestsPerSecond)}</KeyValue>
            <KeyValue label={t('drawer.fields.p95')}>{formatMs(s.p95ResponseTimeMs)}</KeyValue>
            <KeyValue label={t('drawer.fields.p99')}>{formatMs(s.loadLatencyP99Ms)}</KeyValue>
            {/* probeErrorRate is already a percentage (0–100) */}
            <KeyValue label={t('drawer.fields.errorRate')}>
              {s.probeErrorRate !== null ? `${s.probeErrorRate.toFixed(1)}%` : '—'}
            </KeyValue>
            <KeyValue label={t('drawer.fields.confidence')}>{getConfidenceLabel(s.probeConfidence)}</KeyValue>
            <KeyValue label={t('drawer.fields.lastMeasured')}>
              {s.lastProbeAt ? `${timeAgo(s.lastProbeAt)} · ${formatDateTime(s.lastProbeAt)}` : t('drawer.notMeasured')}
            </KeyValue>
          </section>

          <section>
            <h4 className={sectionTitle}>{t('drawer.sections.health')}</h4>
            <KeyValue label={t('drawer.fields.avgResponse')}>{formatMs(s.avgResponseTimeMs)}</KeyValue>
            <KeyValue label={t('drawer.fields.currentLoad')}>
              {s.currentLoadPercent !== null ? `${s.currentLoadPercent.toFixed(0)}%` : '—'}
            </KeyValue>
            <KeyValue label={t('drawer.fields.originReachable')}>{yesNo(s.originReachable)}</KeyValue>
            <KeyValue label={t('drawer.fields.httpsOrigin')}>{yesNo(s.sslEnabled)}</KeyValue>
            <KeyValue label={t('drawer.fields.lastCheck')}>{timeAgo(s.lastHealthCheckAt)}</KeyValue>
          </section>

          {/* ---------- Actions ---------- */}
          {needsOwnership && (
            <div className="zp-anim-fade-up flex gap-3 rounded-xl border border-amber-400/25 bg-amber-500/6 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div className="text-sm">
                <p className="font-medium text-amber-100">{t('drawer.prove.title')}</p>
                <p className="mt-0.5 text-xs text-amber-200/70">{t('drawer.prove.text')}</p>
                <Button size="sm" className="mt-3" icon={Globe} onClick={() => onOpenDns(s)}>
                  {t('drawer.prove.open')}
                </Button>
              </div>
            </div>
          )}

          {canManage ? (
            <div className="space-y-2">
              <Button
                variant="primary"
                className="w-full"
                icon={cooldown > 0 ? Timer : probing ? Activity : Radar}
                loading={starting}
                disabled={unverified || probing || cooldown > 0 || inMaintenance}
                onClick={() => void startProbe()}
              >
                {probing
                  ? t('drawer.measuring')
                  : cooldown > 0
                  ? t('drawer.retryIn', { s: cooldown })
                  : t('drawer.remeasure')}
              </Button>

              {unverified && (
                <p className="text-center text-xs text-amber-300/80">{t('drawer.unverifiedHint')}</p>
              )}
              {inMaintenance && !unverified && (
                <p className="text-center text-xs text-slate-500">{t('drawer.maintenanceHint')}</p>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-500">
              {t('drawer.ownerOnly')}
            </p>
          )}
        </div>
      )}
    </Drawer>
  )
}
