// frontend/src/pages/servers/DnsModal.tsx — DNS instructions & verification

import { useEffect, useRef, useState } from 'react'
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

type RecordField = { key: 'type' | 'name' | 'value' | 'ttl'; label: string; copy: boolean }

const RECORD_FIELDS: RecordField[] = [
  { key: 'type', label: 'Type', copy: false },
  { key: 'name', label: 'Name', copy: true },
  { key: 'value', label: 'Value', copy: true },
  { key: 'ttl', label: 'TTL', copy: false },
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
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4">
      {badge && (
        <div className="mb-2">
          <Badge tone="slate">{badge}</Badge>
        </div>
      )}

      {RECORD_FIELDS.map((f) => {
        const value = String(rec[f.key])
        return (
          <div
            key={f.key}
            className="flex items-center justify-between gap-2 border-t border-white/5 py-2 first:border-0 first:pt-0"
          >
            <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {f.label}
            </span>
            <code dir="ltr" className="min-w-0 flex-1 break-all font-mono text-xs text-slate-200">
              {f.key === 'ttl' ? `${value}s` : value}
            </code>
            {f.copy ? (
              <CopyButton text={value} label={`Record ${f.label.toLowerCase()}`} />
            ) : (
              <span className="w-8 shrink-0" />
            )}
          </div>
        )
      })}

      {rec.note && (
        <p dir="auto" className="mt-2 text-xs text-slate-500">
          {rec.note}
        </p>
      )}
    </div>
  )
}

function CheckResult({ label, check }: { label: string; check: DnsCheckResult }) {
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
        <span className="ml-auto text-[11px] font-normal text-slate-500">
          {new Date(check.checkedAt).toLocaleTimeString()}
        </span>
      </p>

      <p dir="auto" className="mt-1 text-xs text-slate-400">
        {check.message}
      </p>

      {!check.verified && (
        <div dir="ltr" className="mt-2 space-y-1.5 font-mono text-[11px]">
          <p className="break-all text-slate-400">
            <span className="text-slate-500">Expected: </span>
            {check.expected.length > 0 ? check.expected.join(', ') : '—'}
          </p>
          <p className="break-all text-slate-400">
            <span className="text-slate-500">Found: </span>
            {check.found.length > 0 ? check.found.join(', ') : 'Nothing found'}
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
  const toastRef = useRef(toast)
  useEffect(() => {
    toastRef.current = toast
  }, [toast])

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
        toastRef.current.error('Failed to load DNS instructions', parseApiError(err).message)
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
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearTimeout(t)
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
        toast.success('Verification complete', res.message)
      } else {
        toast.info('Verification result', res.message)
      }
    } catch (err) {
      const info = getApiErrorInfo(err)
      if (info.status === 429 && info.retryAfterSec) setCooldown(info.retryAfterSec)
      toast.error('Verification failed', parseApiError(err).message)
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
      title="DNS setup"
      description={server?.domain}
      icon={Globe}
      width="max-w-2xl"
      footer={
        canManage ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              icon={ShieldCheck}
              loading={verifying === 'ownership'}
              disabled={blocked || !dns}
              onClick={() => void verify('ownership')}
            >
              {`Verify ownership${cooldownSuffix}`}
            </Button>
            <Button
              icon={Route}
              loading={verifying === 'routing'}
              disabled={blocked || !dns}
              onClick={() => void verify('routing')}
            >
              {`Verify routing${cooldownSuffix}`}
            </Button>
            <Button
              variant="primary"
              icon={Zap}
              loading={verifying === 'all'}
              disabled={blocked || !dns}
              onClick={() => void verify('all')}
            >
              {`Verify all${cooldownSuffix}`}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
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
          <p className="text-sm text-slate-400">Couldn&rsquo;t load the DNS instructions for this server.</p>
          <Button variant="ghost" icon={RefreshCw} onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* ---------- Progress ---------- */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip ok={dnsVerified} label={dnsVerified ? 'Ownership verified' : 'Ownership pending'} />
            <StatusChip ok={gatewayReachable} label={gatewayReachable ? 'Routing verified' : 'Routing pending'} />
          </div>

          {fullyActive && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-sm text-emerald-200/90">
                Your domain is verified and routed through the Gateway. Capacity measurement runs in the background and
                the numbers will appear on the server card shortly.
              </p>
            </div>
          )}

          {/* ---------- Step 1: Ownership ---------- */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Badge tone="cyan">Step 1</Badge>
              Prove domain ownership
            </h4>
            <p className="text-xs text-slate-500">
              Add this TXT record in your DNS provider, wait for it to propagate, then click &ldquo;Verify ownership&rdquo;.
              Keep it in place after verification.
            </p>
            <RecordCard rec={dns.ownership} />
          </section>

          {/* ---------- Step 2: Routing ---------- */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Badge tone="indigo">Step 2</Badge>
              Route your domain to the Gateway
            </h4>

            {dns.routing.length === 0 ? (
              <div className="flex gap-2 rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <p className="text-xs text-amber-200/90">
                  Gateway routing isn&rsquo;t configured on the platform yet, so there are no routing records to show.
                  Please contact support.
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-500">
                  {dns.routing.length > 1
                    ? 'Choose ONE of the options below (not both). Use CNAME for subdomains and A for root domains.'
                    : 'Add this record, then click “Verify routing”.'}
                </p>
                <div className="space-y-3">
                  {dns.routing.map((rec, i) => (
                    <RecordCard
                      key={`${rec.type}-${rec.value}-${i}`}
                      rec={rec}
                      badge={dns.routing.length > 1 ? `Option ${i + 1}` : undefined}
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ---------- Warnings ---------- */}
          {dns.warnings.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
              {dns.warnings.map((w, i) => (
                <p key={i} dir="auto" className="flex gap-2 text-xs text-amber-200/90">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* ---------- How it works ---------- */}
          {dns.steps.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-white">How it works</h4>
              <ol className="space-y-1.5 text-sm text-slate-400">
                {dns.steps.map((s, i) => (
                  <li key={i} dir="auto" className="flex gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] text-slate-300">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ---------- Verification result ---------- */}
          {result && (result.ownership || result.routing) && (
            <section className="zp-anim-fade-up space-y-2">
              <h4 className="text-sm font-semibold text-white">Latest check</h4>
              {result.ownership && <CheckResult label="Ownership (TXT)" check={result.ownership} />}
              {result.routing && <CheckResult label="Routing (CNAME / A)" check={result.routing} />}
            </section>
          )}

          {cooldown > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Too many checks. You can verify again in {cooldown}s.
            </p>
          )}

          {!canManage && (
            <p className="text-xs text-slate-600">Only Owners and Admins can run verification.</p>
          )}
        </>
      )}
    </Modal>
  )
}