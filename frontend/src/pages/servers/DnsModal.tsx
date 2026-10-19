// frontend/src/pages/servers/DnsModal.tsx
// ==================================================================
// Zero Plus - DNS Setup & Verification Modal
// تعليمات الـ DNS + التحقق من الملكية والتوجيه
// ==================================================================

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Info,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react'

import { useToast } from '../../components/ui/Toast'
import { Badge, Button, Modal, Skeleton } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import {
  getServerDns,
  verifyServer,
  type DnsInstructions,
  type DnsVerificationResult,
  type Server,
} from '../../services/serversService'
import { cn } from '../../utils/format'
import { CopyButton } from './shared'

// ==================================================================
// Component
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

  // ----------------------------------------------------------------
  // Load DNS instructions
  // ----------------------------------------------------------------

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
        if (!cancelled) {
          toast.error('Failed to load DNS instructions', parseApiError(err).message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [serverId, initialDns, toast])

  // ----------------------------------------------------------------
  // Verify
  // ----------------------------------------------------------------

  const verify = async (step: 'ownership' | 'routing' | 'all') => {
    if (!server) return

    setVerifying(step)

    try {
      const res = await verifyServer(server.id, step)
      setResult(res.data)
      onVerified(res.data.server)

      const fullyVerified =
        res.data.server.dnsVerified && res.data.server.gatewayReachable

      if (fullyVerified) {
        toast.success(res.message || 'Domain fully verified')
      } else {
        toast.info(res.message || 'Verification completed — check results below')
      }
    } catch (err) {
      // الباك بيرجع رسالة cooldown لو المحاولة متكررة بسرعة
      toast.error('Verification failed', parseApiError(err).message)
    } finally {
      setVerifying(null)
    }
  }

  const records = dns ? [dns.ownership, ...dns.routing] : []

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <Modal
      open={server !== null}
      onClose={onClose}
      title="DNS Setup & Verification"
      description={server?.domain}
      icon={Globe}
      width="max-w-2xl"
      footer={
        canManage ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>

            <Button
              icon={ShieldCheck}
              loading={verifying === 'ownership'}
              disabled={verifying !== null}
              onClick={() => void verify('ownership')}
            >
              Verify Ownership
            </Button>

            <Button
              variant="primary"
              icon={Zap}
              loading={verifying === 'all'}
              disabled={verifying !== null}
              onClick={() => void verify('all')}
            >
              Verify All
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {loading || !dns ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ========================================================
              Intro explanation
          ======================================================== */}
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="flex gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              <div className="space-y-1.5 text-sm text-slate-300">
                <p className="font-medium text-white">
                  Why do we need these DNS records?
                </p>
                <p className="text-xs leading-relaxed text-slate-400">
                  <strong className="text-slate-300">Step 1 (Ownership)</strong> proves
                  you control the domain using a TXT record.
                  <br />
                  <strong className="text-slate-300">Step 2 (Routing)</strong> points
                  your traffic to Zero Plus Gateway so we can protect it.
                </p>
              </div>
            </div>
          </div>

          {/* ========================================================
              DNS Records
          ======================================================== */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Required DNS Records
            </h3>

            {records.map((rec, i) => (
              <div
                key={`${rec.type}-${i}`}
                className="rounded-xl border border-white/8 bg-white/3 p-4"
              >
                {/* Header */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone={rec.purpose === 'OWNERSHIP' ? 'cyan' : 'indigo'}>
                    {rec.purpose === 'OWNERSHIP'
                      ? 'Step 1 · Ownership (TXT)'
                      : 'Step 2 · Routing'}
                  </Badge>
                  <Badge tone="slate">{rec.type}</Badge>
                  <span className="ml-auto text-[11px] text-slate-600">
                    TTL {rec.ttl}s
                  </span>
                </div>

                {/* Name + Value */}
                {(['name', 'value'] as const).map((field) => (
                  <div
                    key={field}
                    className="flex items-start justify-between gap-3 border-t border-white/5 py-2.5 first:border-0 first:pt-0"
                  >
                    <span className="w-14 shrink-0 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {field}
                    </span>
                    <code
                      dir="ltr"
                      className="min-w-0 flex-1 break-all rounded-md bg-black/20 px-2 py-1 text-xs text-slate-200"
                    >
                      {rec[field]}
                    </code>
                    <CopyButton
                      text={rec[field]}
                      label={field === 'name' ? 'Record name' : 'Record value'}
                    />
                  </div>
                ))}

                {rec.note && (
                  <p dir="auto" className="mt-2 text-xs leading-relaxed text-slate-500">
                    {rec.note}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* ========================================================
              Warnings
          ======================================================== */}
          {dns.warnings.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                Important warnings
              </p>
              {dns.warnings.map((w, i) => (
                <p
                  key={i}
                  dir="auto"
                  className="flex gap-2 text-xs leading-relaxed text-amber-200/90"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/70" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* ========================================================
              Steps
          ======================================================== */}
          {dns.steps.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                How to add these records
              </h3>
              <ol className="space-y-2">
                {dns.steps.map((s, i) => (
                  <li key={i} dir="auto" className="flex gap-3 text-sm text-slate-400">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/8 text-[11px] font-medium text-slate-300">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ========================================================
              Verification Result
          ======================================================== */}
          {result && (
            <div className="zp-anim-fade-up space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Verification results
              </h3>

              {(
                [
                  ['Ownership (TXT record)', result.ownership],
                  ['Routing (CNAME / A record)', result.routing],
                ] as const
              ).map(([label, check]) =>
                check ? (
                  <div
                    key={label}
                    className={cn(
                      'rounded-xl border p-4',
                      check.verified
                        ? 'border-emerald-400/25 bg-emerald-500/5'
                        : 'border-rose-500/25 bg-rose-500/5',
                    )}
                  >
                    <p className="flex items-center gap-2 text-sm font-medium text-white">
                      {check.verified ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-400" />
                      )}
                      {label}
                      <span
                        className={cn(
                          'ml-auto text-[11px] font-semibold uppercase tracking-wide',
                          check.verified ? 'text-emerald-400' : 'text-rose-400',
                        )}
                      >
                        {check.verified ? 'Verified' : 'Not verified'}
                      </span>
                    </p>

                    <p dir="auto" className="mt-2 text-xs leading-relaxed text-slate-400">
                      {check.message}
                    </p>

                    {!check.verified && check.found.length > 0 && (
                      <div className="mt-2 rounded-md bg-black/20 px-2.5 py-1.5">
                        <p className="text-[11px] text-slate-500">
                          Found in DNS:{' '}
                          <span dir="ltr" className="font-mono text-slate-400">
                            {check.found.join(', ')}
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                ) : null,
              )}
            </div>
          )}

          {/* ========================================================
              Permission note
          ======================================================== */}
          {!canManage && (
            <p className="rounded-lg border border-white/5 bg-white/2 px-3 py-2 text-xs text-slate-600">
              Only Owners and Admins can run DNS verification.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}