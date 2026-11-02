// frontend/src/pages/servers/ServerDetailDrawer.tsx
// ==================================================================
// تفاصيل السيرفر + نتائج قياس السعة (Origin Probe)
//   GET  /servers/:id          → التفاصيل بحقول الـ Probe كاملة
//   POST /servers/:id/probe    → 202 فورًا (OWNER/ADMIN)، والنتيجة توصل بعد ~دقيقتين
//                                 عن طريق Socket (server:status) أو GET جديد
// حالات الأخطاء:
//   409 OWNERSHIP_REQUIRED     → لازم تثبت ملكية الدومين الأول (زرار يفتح خطوات الـ DNS)
//   429 PROBE_TOO_FREQUENT     → عدّاد تنازلي من Retry-After / details.retryAfterSec
//   404 SERVER_NOT_FOUND       → السيرفر اتحذف أو مش تبع الشركة
// الصفحة بتبعتلنا server محدّث لحظيًا من السوكيت؛ لما lastProbeAt يتغير
// بنعرف إن القياس خلص ونجيب التفاصيل من جديد.
// ==================================================================

import { useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, Gauge, Globe, Loader2, Radar, Timer } from 'lucide-react'

import { useToast } from '../../components/ui/Toast'
import { Badge, Button, Drawer, KeyValue, Skeleton } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { getServer, probeServer, type Server } from '../../services/serversService'
import { CONFIDENCE_LABEL, REC_META, formatRps } from '../../utils/serverMeta'
import { formatDateTime, formatMs, formatPercent, timeAgo } from '../../utils/format'
import { STATUS_META } from './shared'

/** الباك بيقول النتيجة خلال دقيقتين تقريبًا: بنفضل في حالة "جاري القياس" لحد 150 ثانية */
const PROBE_WAIT_MS = 150_000

export default function ServerDetailDrawer({
  server,
  canManage,
  onClose,
  onOpenDns,
  onServerUpdated,
}: {
  /** السيرفر من القايمة (بيتحدّث لحظيًا من السوكيت) */
  server: Server | null
  canManage: boolean
  onClose: () => void
  onOpenDns: (server: Server) => void
  onServerUpdated: (server: Server) => void
}) {
  const toast = useToast()
  const [full, setFull] = useState<Server | null>(null)
  const [loading, setLoading] = useState(false)
  const [probing, setProbing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [needsOwnership, setNeedsOwnership] = useState(false)

  // lastProbeAt وقت بداية القياس: لو اتغير يبقى القياس خلص
  const probeStartedWith = useRef<string | null>(null)
  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const id = server?.id
  const lastProbeAt = server?.lastProbeAt ?? null
  const updatedAt = server?.updatedAt

  // ---------------- جلب التفاصيل (أول مرة + كل ما السيرفر يتحدّث) ----------------
  useEffect(() => {
    if (!id) {
      setFull(null)
      return
    }
    let cancelled = false
    setLoading(true)
    getServer(id)
      .then((data) => {
        if (cancelled) return
        setFull(data)
        onServerUpdated(data)
      })
      .catch((err) => {
        if (cancelled) return
        const parsed = parseApiError(err)
        if (parsed.status === 404) {
          toast.error('Server not found', 'It may have been deleted.')
          onClose()
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // onServerUpdated/onClose/toast ثابتين نسبيًا؛ مش عايزين loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lastProbeAt, updatedAt])

  // ---------------- القياس خلص؟ ----------------
  useEffect(() => {
    if (probing && lastProbeAt !== probeStartedWith.current) {
      setProbing(false)
      if (probeTimer.current) clearTimeout(probeTimer.current)
      toast.success('Capacity measurement finished', server?.domain)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastProbeAt])

  // ---------------- عدّاد 429 ----------------
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // تنظيف عند قفل الـ Drawer
  useEffect(() => {
    if (!id) {
      setProbing(false)
      setNeedsOwnership(false)
      setCooldown(0)
    }
    return () => {
      if (probeTimer.current) clearTimeout(probeTimer.current)
    }
  }, [id])

  const s = full && full.id === id ? full : server

  // ---------------- إعادة القياس ----------------
  const startProbe = async () => {
    if (!s) return
    setStarting(true)
    setNeedsOwnership(false)
    try {
      const res = await probeServer(s.id)
      // 202: القياس بدأ، النتيجة هتوصل بعدين
      probeStartedWith.current = s.lastProbeAt
      setProbing(true)
      toast.info('Measurement started', res.message)
      if (probeTimer.current) clearTimeout(probeTimer.current)
      probeTimer.current = setTimeout(() => setProbing(false), PROBE_WAIT_MS)
    } catch (err) {
      const { status, code, message, retryAfterSec } = parseApiError(err)
      if (status === 409 || code === 'OWNERSHIP_REQUIRED') {
        setNeedsOwnership(true)
        toast.warning('Verify domain ownership first', message)
      } else if (status === 429 || code === 'PROBE_TOO_FREQUENT') {
        setCooldown(retryAfterSec ?? 60)
        toast.warning('Please wait before measuring again', message)
      } else if (status === 404) {
        toast.error('Server not found', message)
        onClose()
      } else {
        toast.error('Could not start the measurement', message)
      }
    } finally {
      setStarting(false)
    }
  }

  const rec = s?.probeRecommendation ? REC_META[s.probeRecommendation] : undefined
  const unverified = s ? !s.dnsVerified : false
  const neverMeasured = s ? s.lastProbeAt === null : false

  return (
    <Drawer
      open={server !== null}
      onClose={onClose}
      title={s?.domain ?? 'Server'}
      subtitle={s ? `${s.originIp}:${s.originPort} · ${s.mode === 'PROTECT' ? 'Protect' : 'Monitor only'}` : undefined}
    >
      {s && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_META[s.status].tone} dot>{STATUS_META[s.status].label}</Badge>
            <Badge tone={s.dnsVerified ? 'emerald' : 'amber'}>{s.dnsVerified ? 'Domain verified' : 'Not verified'}</Badge>
            <Badge tone={s.gatewayReachable ? 'emerald' : 'slate'}>{s.gatewayReachable ? 'Routing OK' : 'Routing pending'}</Badge>
          </div>

          {/* ---------- السعة الآمنة (الرقم الأساسي) ---------- */}
          <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Gauge className="h-3.5 w-3.5 text-cyan-400" /> Safe capacity
            </p>
            {probing ? (
              <div className="mt-3 flex items-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-cyan-300" />
                <div>
                  <p className="text-lg font-semibold text-white">Measuring…</p>
                  <p className="text-xs text-slate-500">This takes about two minutes. The result appears here by itself.</p>
                </div>
              </div>
            ) : loading && !full ? (
              <Skeleton className="mt-3 h-10 w-40" />
            ) : s.safeRequestsPerSecond !== null ? (
              <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                <p className="zp-anim-fade-up text-4xl font-bold tracking-tight text-white">
                  {s.safeRequestsPerSecond.toLocaleString('en-US')}
                  <span className="ml-1.5 text-base font-medium text-slate-500">req/s</span>
                </p>
                {rec && <Badge tone={rec.tone}>{rec.label}</Badge>}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                {neverMeasured ? 'Not measured yet' : 'No usable result from the last measurement'}
              </p>
            )}
          </div>

          {/* ---------- تفاصيل القياس ---------- */}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">Measurement</h4>
            <KeyValue label="Max sustained rate">{formatRps(s.maxRequestsPerSecond)}</KeyValue>
            <KeyValue label="Response P95 (idle)">{formatMs(s.p95ResponseTimeMs)}</KeyValue>
            <KeyValue label="Response P99 (under load)">{formatMs(s.loadLatencyP99Ms)}</KeyValue>
            <KeyValue label="Error rate">
              {s.probeErrorRate !== null ? formatPercent(s.probeErrorRate * (s.probeErrorRate <= 1 ? 100 : 1)) : '—'}
            </KeyValue>
            <KeyValue label="Confidence">
              {s.probeConfidence ? CONFIDENCE_LABEL[s.probeConfidence] ?? s.probeConfidence : '—'}
            </KeyValue>
            <KeyValue label="Last measured">
              {s.lastProbeAt ? `${timeAgo(s.lastProbeAt)} · ${formatDateTime(s.lastProbeAt)}` : 'Not measured yet'}
            </KeyValue>
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">Health</h4>
            <KeyValue label="Avg response">{formatMs(s.avgResponseTimeMs)}</KeyValue>
            <KeyValue label="Current load">{s.currentLoadPercent !== null ? `${s.currentLoadPercent.toFixed(0)}%` : '—'}</KeyValue>
            <KeyValue label="Origin reachable">{s.originReachable ? 'Yes' : 'No'}</KeyValue>
            <KeyValue label="HTTPS origin">{s.sslEnabled ? 'Yes' : 'No'}</KeyValue>
            <KeyValue label="Last health check">{timeAgo(s.lastHealthCheckAt)}</KeyValue>
          </section>

          {/* ---------- إجراءات ---------- */}
          {needsOwnership && (
            <div className="zp-anim-fade-up flex gap-3 rounded-xl border border-amber-400/25 bg-amber-500/6 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div className="text-sm">
                <p className="font-medium text-amber-100">Prove you own this domain first</p>
                <p className="mt-0.5 text-xs text-amber-200/70">Capacity can only be measured for verified domains.</p>
                <Button size="sm" className="mt-3" icon={Globe} onClick={() => onOpenDns(s)}>Open DNS setup</Button>
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
                disabled={unverified || probing || cooldown > 0 || s.status === 'MAINTENANCE'}
                onClick={() => void startProbe()}
              >
                {probing ? 'Measuring…' : cooldown > 0 ? `Try again in ${cooldown}s` : 'Re-measure capacity'}
              </Button>
              {unverified && (
                <p className="text-center text-xs text-amber-300/80">Verify domain ownership to enable measurement.</p>
              )}
              {s.status === 'MAINTENANCE' && !unverified && (
                <p className="text-center text-xs text-slate-500">Measurement is paused while the server is in maintenance.</p>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-500">
              Only Owners and Admins can re-measure capacity.
            </p>
          )}
        </div>
      )}
    </Drawer>
  )
}
