// frontend/src/pages/servers/DnsModal.tsx — تعليمات الـ DNS والتحقق

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Globe, ShieldCheck, XCircle, Zap } from 'lucide-react'
import { useToast } from '../../components/ui/Toast'
import { Badge, Button, Modal, Skeleton } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { getServerDns, verifyServer, type DnsInstructions, type DnsVerificationResult, type Server } from '../../services/serversService'
import { cn } from '../../utils/format'
import { CopyButton } from './shared'


// ==================================================================
// DNS instructions + verification modal
// ==================================================================

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
  /** بنحدّث كارت السيرفر بنتيجة التحقق */
  onVerified: (result: DnsVerificationResult['server']) => void
}) {
  const toast = useToast()
  const [dns, setDns] = useState<DnsInstructions | null>(initialDns)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState<'ownership' | 'routing' | 'all' | null>(null)
  const [result, setResult] = useState<DnsVerificationResult | null>(null)

  const serverId = server?.id
  useEffect(() => {
    if (!serverId) return
    setResult(null)
    setDns(initialDns)
    if (initialDns) return

    let cancelled = false
    setLoading(true)
    getServerDns(serverId)
      .then((res) => {
        if (!cancelled) setDns(res.dns)
      })
      .catch((err) => {
        if (!cancelled) toast.error('Failed to load DNS instructions', parseApiError(err).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serverId, initialDns, toast])

  const verify = async (step: 'ownership' | 'routing' | 'all') => {
    if (!server) return
    setVerifying(step)
    try {
      const res = await verifyServer(server.id, step)
      setResult(res.data)
      onVerified(res.data.server)
      const ok = res.data.server.dnsVerified && res.data.server.gatewayReachable
      if (ok) toast.success(res.message)
      else toast.info(res.message)
    } catch (err) {
      // فيه cooldown بين كل محاولتين: رسالة الباك بتقول الانتظار كام ثانية
      toast.error('Verification failed', parseApiError(err).message)
    } finally {
      setVerifying(null)
    }
  }

  const records = dns ? [dns.ownership, ...dns.routing] : []

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
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button icon={ShieldCheck} loading={verifying === 'ownership'} disabled={verifying !== null} onClick={() => void verify('ownership')}>
              Verify ownership
            </Button>
            <Button variant="primary" icon={Zap} loading={verifying === 'all'} disabled={verifying !== null} onClick={() => void verify('all')}>
              Verify all
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>Close</Button>
        )
      }
    >
      {loading || !dns ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* ---------- Records ---------- */}
          <div className="space-y-3">
            {records.map((rec, i) => (
              <div key={`${rec.type}-${i}`} className="rounded-xl border border-white/8 bg-white/3 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Badge tone={rec.purpose === 'OWNERSHIP' ? 'cyan' : 'indigo'}>
                    {rec.purpose === 'OWNERSHIP' ? 'Step 1 · Ownership' : 'Step 2 · Routing'}
                  </Badge>
                  <Badge tone="slate">{rec.type}</Badge>
                  <span className="ml-auto text-xs text-slate-600">TTL {rec.ttl}s</span>
                </div>
                {(['name', 'value'] as const).map((field) => (
                  <div key={field} className="flex items-center justify-between gap-2 border-t border-white/5 py-2 first:border-0">
                    <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {field}
                    </span>
                    <code dir="ltr" className="min-w-0 flex-1 break-all text-xs text-slate-200">{rec[field]}</code>
                    <CopyButton text={rec[field]} label={field === 'name' ? 'Record name' : 'Record value'} />
                  </div>
                ))}
                {rec.note && <p dir="auto" className="mt-2 text-xs text-slate-500">{rec.note}</p>}
              </div>
            ))}
          </div>

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

          {dns.steps.length > 0 && (
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
          )}

          {/* ---------- Verification result ---------- */}
          {result && (
            <div className="zp-anim-fade-up space-y-2">
              {(
                [
                  ['Ownership (TXT)', result.ownership],
                  ['Routing (CNAME / A)', result.routing],
                ] as const
              ).map(([label, check]) =>
                check ? (
                  <div
                    key={label}
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
                    </p>
                    <p dir="auto" className="mt-1 text-xs text-slate-400">{check.message}</p>
                    {!check.verified && check.found.length > 0 && (
                      <p dir="ltr" className="mt-1.5 break-all font-mono text-[11px] text-slate-500">
                        Found: {check.found.join(', ')}
                      </p>
                    )}
                  </div>
                ) : null,
              )}
            </div>
          )}

          {!canManage && (
            <p className="text-xs text-slate-600">Only Owners and Admins can run verification.</p>
          )}
        </>
      )}
    </Modal>
  )
}
