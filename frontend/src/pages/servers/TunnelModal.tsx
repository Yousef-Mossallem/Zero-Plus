// frontend/src/pages/servers/TunnelModal.tsx
// ==================================================================
// مودال تفعيل النفق / عرض أمر التثبيت (Guard / Agent)
// يعرض:
//  - خيارات التثبيت: Script (curl | bash) / Docker / Binary
//  - أمر التثبيت الكامل في صندوق monospace جاهز للنسخ
//  - تحذير أن التوكن يظهر مرة واحدة
//  - زر إعادة تدوير التوكن في حال فقدانه
// ==================================================================

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  RotateCcw,
  Shield,
  Terminal,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Modal } from '../../components/ui/kit'
import {
  enableTunnel,
  getAgentStatus,
  getApiErrorInfo,
  rotateAgentToken,
  type AgentStatus,
  type EnableTunnelResult,
  type InstallChannel,
  type Server,
} from '../../services/serversService'
import { useToast } from '../../components/ui/Toast'
import { timeAgo } from '../../utils/format'

export function TunnelModal({
  open,
  server,
  initialData,
  onClose,
  onEnabled,
}: {
  open: boolean
  server: Server | null
  initialData?: EnableTunnelResult | null
  onClose: () => void
  onEnabled?: () => void
}) {
  const toast = useToast()
  const { t } = useTranslation('servers')
  const [data, setData] = useState<EnableTunnelResult | null>(initialData ?? null)
  const [channel, setChannel] = useState<InstallChannel>(initialData?.install.channel ?? 'script')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)

  // Sync if initialData changes
  if (initialData && (!data || data.serverId !== initialData.serverId)) {
    setData(initialData)
    if (initialData.install.channel) setChannel(initialData.install.channel)
  }

  // السيرفر اتغيّر → امسح بيانات التوكن القديمة (متعرضش أمر سيرفر تاني)
  if (server && data && data.serverId !== server.id && !initialData) {
    setData(null)
  }

  // ---- متابعة حالة الـ Agent / النفق لحظيًا طول ما المودال مفتوح ----
  const [agent, setAgent] = useState<AgentStatus | null>(null)
  const wasUp = useRef(false)
  const serverId = server?.id
  useEffect(() => {
    if (!open || !serverId) return
    let cancelled = false
    wasUp.current = false
    setAgent(null)
    const poll = async () => {
      try {
        const st = await getAgentStatus(serverId)
        if (cancelled) return
        setAgent(st)
        if (st.tunnelUp && !wasUp.current) {
          wasUp.current = true
          onEnabled?.()
        }
      } catch {
        // الـ polling بيكمل — الخطأ المؤقت مش مشكلة
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serverId])

  if (!server) return null

  const handleCopy = async () => {
    if (!data?.install.command) return
    try {
      await navigator.clipboard.writeText(data.install.command)
      setCopied(true)
      toast.success(
        t('tunnel.copiedTitle'),
        t('tunnel.copiedDesc'),
      )
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast.error(t('tunnel.copyFailed'))
    }
  }

  const handleChangeChannel = async (newChannel: InstallChannel) => {
    setChannel(newChannel)
    if (!server) return
    setBusy(true)
    try {
      // Re-fetch command with different format
      const res = await enableTunnel(server.id, {
        installChannel: newChannel,
        rotateToken: false,
      })
      setData(res)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { code?: string } } } }
      // إذا كان التوكن قد تم إصداره مسبقاً ولا يمكن استرجاعه بدون rotate
      if (e.response?.data?.error?.code === 'AGENT_TOKEN_ALREADY_ISSUED') {
        toast.warning(
          t('tunnel.alreadyIssued'),
          t('tunnel.needRotate'),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const handleRotate = async () => {
    if (!server) return
    setBusy(true)
    try {
      const res = await rotateAgentToken(server.id, {
        confirm: true,
        installChannel: channel,
      })
      setData(res)
      setConfirmRotate(false)
      toast.success(
        t('tunnel.rotatedTitle'),
        t('tunnel.rotatedDesc'),
      )
      onEnabled?.()
    } catch (err) {
      toast.error(
        t('tunnel.rotateFailed'),
        getApiErrorInfo(err).message,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('tunnel.modalTitle')}
      description={`${server.domain} — ${t('tunnel.modalSubtitle')}`}
      icon={Shield}
      tone="cyan"
      width="max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            {!confirmRotate ? (
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                disabled={busy}
                onClick={() => setConfirmRotate(true)}
              >
                {t('tunnel.rotateBtn')}
              </Button>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-500/10 p-1 text-xs">
                <span className="text-amber-300 px-1">{t('tunnel.confirmRotate')}</span>
                <Button variant="danger" size="sm" loading={busy} onClick={() => void handleRotate()}>
                  {t('tunnel.yesRotate')}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmRotate(false)}>
                  {t('actions.cancel')}
                </Button>
              </div>
            )}
          </div>
          <Button variant="primary" onClick={onClose}>
            {t('tunnel.done')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Warning: Token is single-view */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/8 p-3.5 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-semibold">{t('tunnel.warningTitle')}</p>
            <p className="mt-0.5 text-amber-200/80">
              {data?.install.tokenHint ??
                t('tunnel.warningDesc')}
            </p>
          </div>
        </div>

        {/* Channel Selection */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-300">
            {t('tunnel.channelLabel')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'script', label: 'Shell Script (curl | bash)', icon: Terminal },
                { id: 'docker', label: 'Docker Container', icon: Shield },
                { id: 'binary', label: 'Standalone Binary', icon: Key },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => void handleChangeChannel(item.id)}
                className={`flex flex-col items-center justify-center rounded-xl border p-2.5 text-xs transition ${
                  channel === item.id
                    ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200'
                    : 'border-white/8 bg-white/3 text-slate-400 hover:border-white/15 hover:text-white'
                }`}
              >
                <item.icon className="mb-1 h-4 w-4" />
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Command Box */}
        {data?.install.command ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">
                {t('tunnel.commandLabel')}
              </span>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400">{t('tunnel.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{t('tunnel.copy')}</span>
                  </>
                )}
              </button>
            </div>

            <div className="relative rounded-xl border border-white/10 bg-[#04060d] p-3.5">
              <pre className="max-h-40 overflow-x-auto font-mono text-xs text-cyan-300 whitespace-pre-wrap break-all select-all">
                {data.install.command}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
            <Key className="mb-2 h-6 w-6 text-slate-500" />
            <p>{t('tunnel.noTokenCached')}</p>
            <Button
              variant="outline"
              size="sm"
              icon={RotateCcw}
              className="mt-3"
              loading={busy}
              onClick={() => void handleRotate()}
            >
              {t('tunnel.generateNew')}
            </Button>
          </div>
        )}

        {/* Steps Guide */}
        <div className="rounded-xl border border-white/6 bg-white/2 p-3 text-xs text-slate-400 space-y-2">
          <p className="font-semibold text-slate-300">{t('tunnel.stepsTitle')}</p>
          <ol className="list-decimal list-inside space-y-1 text-slate-400">
            <li>{t('tunnel.step1')}</li>
            <li>{t('tunnel.step2')}</li>
            <li>{t('tunnel.step3')}</li>
          </ol>
        </div>

        {/* Live agent / tunnel status */}
        <div
          className={`flex items-start gap-3 rounded-xl border p-3 text-xs ${
            agent?.tunnelUp
              ? 'border-emerald-400/25 bg-emerald-500/8 text-emerald-200'
              : 'border-white/8 bg-white/3 text-slate-300'
          }`}
          role="status"
          aria-live="polite"
        >
          {agent?.tunnelUp ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-slate-400" />
          )}
          <div className="min-w-0">
            <p className="font-semibold">
              {agent?.tunnelUp ? t('tunnel.statusConnected') : t('tunnel.statusWaiting')}
            </p>
            {agent?.tunnelUp && (
              <p className="mt-0.5 text-emerald-200/80">
                {agent.agentVersion ? `${t('tunnel.statusVersion')}: ${agent.agentVersion} · ` : ''}
                {agent.lastAgentAt ? `${t('tunnel.statusLastSeen')}: ${timeAgo(agent.lastAgentAt)}` : ''}
              </p>
            )}
          </div>
        </div>

        {data?.install.docsUrl && (
          <a
            href={data.install.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:underline"
          >
            <span>{t('tunnel.docsLink')}</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </Modal>
  )
}
