// frontend/src/pages/servers/DnsModal.tsx — DNS instructions & verification
// i18n: النصوص من servers.dns. سجلات الـ DNS نفسها (النوع/الاسم/القيمة) بتفضل LTR
// بالإنجليزي، والتحذيرات/الخطوات اللي جاية من الباك بتتعرض زي ما هي (dir=auto).

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  RefreshCw,
  Route,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react'
import { useToast } from '../../components/ui/Toast'
import { Badge, Button, Modal, Skeleton } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import {
  getApiErrorInfo,
  getServerDns,
  verifyServer,
  type DnsCheckResult,
  type DnsInstructions,
  type DnsRecordInstruction,
  type DnsVerificationResult,
  type Server,
  type VerifyStep,
} from '../../services/serversService'
import { cn } from '../../utils/format'
import { CopyButton } from './shared'

// ==================================================================
// DNS instructions + verification modal
//
// Layout (the Modal handles scrolling: fixed header/footer, scrollable body):
//   1. Progress strip: ownership / routing status
//   2. Step 1 — Ownership record (TXT)
//   3. Step 2 — Routing record (choose ONE: CNAME or A)
//   4. Warnings
//   5. How it works (steps)
//   6. Latest verification result (expected vs found)
//
// Data sources:
//   - initialDns: from the POST /servers response (first open)
//   - GET /servers/:id/dns: when reopened later or after a refresh
//   - server prop: live dnsVerified / gatewayReachable (kept fresh by Socket)
// ==================================================================

// المفتاح بيتترجم (dns.fields.<key>)
const RECORD_FIELDS: { key: 'type' | 'name' | 'value' | 'ttl'; copy: boolean }[] = [
  { key: 'type',  copy: false },
  { key: 'name',  copy: true },
  { key: 'value', copy: true },
  { key: 'ttl',   copy: false },
]

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        ok
          ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
          : 'border-white/10 bg-white/5 text-slate-400',
      )}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      {label}
    </span>
  )
}

function RecordCard({ rec, badge }: { rec: DnsRecordInstruction; badge?: string }) {
  const { t } = useTranslation('servers')
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4">
      {badge && (
        <div className="mb-2">
          <Badge tone="slate">{badge}</Badge>
        </div>
      )}
      {RECORD_FIELDS.map((f) => {
        const value = String(rec[f.key])
        const label = t(`dns.fields.${f.key}`)
        return (
          <div
            key={f.key}
            className="flex items-center justify-between gap-2 border-t border-white/5 py-2 first:border-0 first:pt-0"
          >
            <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {label}
            </span>
            <code dir="ltr" className="min-w-0 flex-1 break-all text-start font-mono text-xs text-slate-200">
              {f.key === 'ttl' ? `${value}s` : value}
            </code>
            {f.copy ? (
              <CopyButton text={value} label={label} />
            ) : (
              <span className="w-8 shrink-0" />
            )}
          </div>
        )
      })}
      {rec.note && <p dir="auto" className="mt-2 text-xs text-slate-500">{rec.note}</p>}
    </div>
  )
}

function CheckResult({ label, check }: { label: string; check: DnsCheckResult }) {
  const { t, i18n } = useTranslation('servers')
  const lng = (i18n.resolvedLanguage ?? 'en').split('-')[0]

  return (
    <div
      className={cn(
        'rounded-xl border p-3.5',
        check.verified ? 'border-emerald-400/25 bg-emerald-500/5' : 'border-rose-500/25 bg-rose-500/5',
      )}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-white">
        {check.verified ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : (
          <XCircle className="h-4 w-4 text-rose-400" />
        )}
        {label}
        <span className="ms-auto text-[11px] font-normal text-slate-500">
          {new Date(check.checkedAt).toLocaleTimeString(`${lng}-u-nu-latn`)}
        </span>
      </p>

      <p dir="auto" className="mt-1 text-xs text-slate-400">{check.message}</p>

      {!check.verified && (
        <div dir="ltr" className="mt-2 space-y-1.5 text-start font-mono text-[11px]">
          <p className="break-all text-slate-400">
            <span className="text-slate-500">{t('dns.expected')}</span>{' '}
            {check.expected.length > 0 ? check.expected.join(', ') : '—'}
          </p>
          <p className="break-all text-slate-400">
            <span className="text-slate-500">{t('dns.found')}</span>{' '}
            {check.found.length > 0 ? check.found.join(', ') : t('dns.nothingFound')}
          </p>
        </div>
      )}
    </div>
  )
}

export function DnsModal({
  server,
  initialDns,
  canManage,
  onClose,
  onVerified,
}: {
  server: Server | null
  initialDns: DnsInstructions | null
  canManage: boolean
  onClose: () => void
  /** Used to update the server card with the verification result */
  onVerified: (result: DnsVerificationResult['server']) => void
}) {
  const toast = useToast()
  const { t } = useTranslation(['servers', 'common'])

  // الـ ref بيحفظ آخر toast و t عشان الـ effects ما تتعيدش مع تغيير اللغة
  const ref = useRef({ toast, t })
  useEffect(() => {
    ref.current = { toast, t }
  }, [toast, t])

  const [dns, setDns] = useState<DnsInstructions | null>(initialDns)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [verifying, setVerifying] = useState<VerifyStep | null>(null)
  const [result, setResult] = useState<DnsVerificationResult | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // Live verification state (initialised from the server, updated after each verify)
  const [dnsVerified, setDnsVerified] = useState(server?.dnsVerified ?? false)
  const [gatewayReachable, setGatewayReachable] = useState(server?.gatewayReachable ?? false)

  const serverId = server?.id

  // Reset local state when a different server is opened
  useEffect(() => {
    setResult(null)
    setCooldown(0)
    setLoadFailed(false)
  }, [serverId])

  // Keep verification flags in sync with the server prop (e.g. Socket updates)
  useEffect(() => {
    setDnsVerified(server?.dnsVerified ?? false)
    setGatewayReachable(server?.gatewayReachable ?? false)
  }, [server?.dnsVerified, server?.gatewayReachable, serverId])

  // Load DNS instructions (skipped when we already have them from the create response)
  useEffect(() => {
    if (!serverId) return
    setDns(initialDns)
    if (initialDns) return

    let cancelled = false
    setLoading(true)
    setLoadFailed(false)

    getServerDns(serverId)
      .then((res) => {
        if (cancelled) return
        setDns(res.dns)
        setDnsVerified(res.status.dnsVerified)
        setGatewayReachable(res.status.gatewayReachable)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadFailed(true)
        ref.current.toast.error(ref.current.t('dns.toast.loadFailed'), parseApiError(err).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [serverId, initialDns, reloadKey])

  // Retry-After countdown (429)
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const verify = async (step: VerifyStep) => {
    if (!server) return
    setVerifying(step)
    try {
      const res = await verifyServer(server.id, step)
      setResult(res.data)
      setDnsVerified(res.data.server.dnsVerified)
      setGatewayReachable(res.data.server.gatewayReachable)
      onVerified(res.data.server)

      if (res.data.server.dnsVerified && res.data.server.gatewayReachable) {
        toast.success(t('dns.toast.complete'), res.message)
      } else {
        toast.info(t('dns.toast.result'), res.message)
      }
    } catch (err) {
      const info = getApiErrorInfo(err)
      if (info.status === 429 && info.retryAfterSec) setCooldown(info.retryAfterSec)
      toast.error(t('dns.toast.failed'), parseApiError(err).message)
    } finally {
      setVerifying(null)
    }
  }

  const busy = verifying !== null
  const blocked = busy || cooldown > 0
  const cooldownSuffix = cooldown > 0 ? ` (${cooldown}s)` : ''
  const fullyActive = dnsVerified && gatewayReachable

  return (
    <Modal
      open={server !== null}
      onClose={onClose}
      title={t('dns.title')}
      description={server?.domain}
      icon={Globe}
      width="max-w-2xl"
      footer={
        canManage ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('actions.close', { ns: 'common' })}
            </Button>
            <Button
              icon={ShieldCheck}
              loading={verifying === 'ownership'}
              disabled={blocked || !dns}
              onClick={() => void verify('ownership')}
            >
              {`${t('dns.verifyOwnership')}${cooldownSuffix}`}
            </Button>
            <Button
              icon={Route}
              loading={verifying === 'routing'}
              disabled={blocked || !dns}
              onClick={() => void verify('routing')}
            >
              {`${t('dns.verifyRouting')}${cooldownSuffix}`}
            </Button>
            <Button
              variant="primary"
              icon={Zap}
              loading={verifying === 'all'}
              disabled={blocked || !dns}
              onClick={() => void verify('all')}
            >
              {`${t('dns.verifyAll')}${cooldownSuffix}`}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t('actions.close', { ns: 'common' })}
          </Button>
        )
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : loadFailed || !dns ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-white/8 bg-white/3 p-6 text-center">
          <p className="text-sm text-slate-400">{t('dns.loadFailed')}</p>
          <Button variant="ghost" icon={RefreshCw} onClick={() => setReloadKey((k) => k + 1)}>
            {t('actions.tryAgain', { ns: 'common' })}
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ---------- Progress ---------- */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip ok={dnsVerified} label={dnsVerified ? t('dns.ownershipVerified') : t('dns.ownershipPending')} />
            <StatusChip
              ok={gatewayReachable}
              label={gatewayReachable ? t('dns.routingVerified') : t('dns.routingPending')}
            />
          </div>

          {fullyActive && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-sm text-emerald-200/90">{t('dns.active')}</p>
            </div>
          )}

          {/* ---------- Step 1: Ownership ---------- */}
          <section className="space-y-2.5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Badge tone="cyan">{t('dns.step1.badge')}</Badge> {t('dns.step1.title')}
            </h4>
            <p className="text-xs leading-relaxed text-slate-500">{t('dns.step1.text')}</p>
            <RecordCard rec={dns.ownership} />
          </section>

          {/* ---------- Step 2: Routing ---------- */}
          <section className="space-y-2.5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Badge tone="indigo">{t('dns.step2.badge')}</Badge> {t('dns.step2.title')}
            </h4>

            {dns.routing.length === 0 ? (
              <div className="flex gap-2 rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <p className="text-xs leading-relaxed text-amber-200/90">{t('dns.noRouting')}</p>
              </div>
            ) : (
              <>
                <p className="text-xs leading-relaxed text-slate-500">
                  {dns.routing.length > 1 ? t('dns.routingMulti') : t('dns.routingSingle')}
                </p>
                <div className="space-y-3">
                  {dns.routing.map((rec, i) => (
                    <RecordCard
                      key={`${rec.type}-${rec.value}-${i}`}
                      rec={rec}
                      badge={dns.routing.length > 1 ? t('dns.option', { n: i + 1 }) : undefined}
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ---------- Warnings (نص جاي من الباك) ---------- */}
          {dns.warnings.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
              {dns.warnings.map((w, i) => (
                <p key={i} dir="auto" className="flex gap-2 text-xs text-amber-200/90">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          {/* ---------- How it works (خطوات جاية من الباك) ---------- */}
          {dns.steps.length > 0 && (
            <section className="space-y-2.5">
              <h4 className="text-sm font-semibold text-white">{t('dns.how')}</h4>
              <ol className="space-y-2 text-sm text-slate-400">
                {dns.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] text-slate-300">
                      {i + 1}
                    </span>
                    <span dir="auto" className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ---------- Verification result ---------- */}
          {result && (result.ownership || result.routing) && (
            <section className="zp-anim-fade-up space-y-2.5">
              <h4 className="text-sm font-semibold text-white">{t('dns.latest')}</h4>
              {result.ownership && <CheckResult label={t('dns.ownershipTxt')} check={result.ownership} />}
              {result.routing && <CheckResult label={t('dns.routingCheck')} check={result.routing} />}
            </section>
          )}

          {cooldown > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" /> {t('dns.cooldown', { s: cooldown })}
            </p>
          )}

          {!canManage && <p className="text-xs text-slate-600">{t('dns.ownerOnly')}</p>}
        </div>
      )}
    </Modal>
  )
}
