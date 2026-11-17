// frontend/src/pages/servers/ServerFormModal.tsx — Add / edit server
// i18n: كل النصوص من servers.form و servers.validation (+ common.actions.cancel).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Globe, Info, Server as ServerIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/Toast'
import { Button, Field, Modal, TextInput, Toggle } from '../../components/ui/kit'
import {
  createServer,
  getApiErrorInfo,
  updateServer,
  type DnsInstructions,
  type Server,
} from '../../services/serversService'
import { cn } from '../../utils/format'
import { EMPTY_FORM, validateServerForm, VALIDATION_PREFIX, type ServerForm } from './shared'

// ==================================================================
// Add / Edit modal
//
// Mirrors the backend rules (servers.schema.ts) so most mistakes are caught
// before the request:
//   - domain: name only (no protocol, path, port, wildcard, IP); lowercased by the backend
//   - originIp: IPv4 only (private ranges are accepted/rejected by the backend
//     depending on the environment, so the server's message is shown under the field)
//   - originPort: 1–65535, and not one of the reserved non-web ports
//   - the request body is strict: only changed fields are sent on edit
//
// After saving, the parent receives the server (+ DNS instructions when the
// domain was added or changed) and opens the DNS modal.
// ==================================================================

/** Same list as the backend (BLOCKED_ORIGIN_PORTS) */
const BLOCKED_PORTS = new Set([
  22, 23, 25, 110, 143, 465, 587, 993, 995, 1433, 3306, 5432, 6379, 9200, 11211, 27017,
])

const FORM_ERROR_KEY = '_form'

/** Backend normalisation: trim + lowercase + strip a trailing dot */
const normalizeDomain = (raw: string) => raw.trim().toLowerCase().replace(/\.$/, '')

/** Extra checks that mirror the backend. Shared validation still runs first. */
function extraValidate(form: ServerForm): Record<string, string> {
  const errs: Record<string, string> = {}

  const domain = form.domain.trim().toLowerCase()
  if (domain) {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(domain)) {
      errs.domain = 'validation.domain.noProtocol'
    } else if (/[\s/?#@\\]/.test(domain)) {
      errs.domain = 'validation.domain.noPath'
    } else if (domain.startsWith('*.')) {
      errs.domain = 'validation.domain.wildcard'
    } else if (domain.includes(':')) {
      errs.domain = 'validation.domain.hasPort'
    }
  }

  if (form.originIp.includes(':')) {
    errs.originIp = 'validation.originIp.ipv6'
  }

  const port = form.originPort.trim()
  if (port !== '' && BLOCKED_PORTS.has(Number(port))) {
    errs.originPort = 'validation.originPort.reserved'
  }

  return errs
}

/** Merge validators; the shared validator wins when both report the same field */
function validateAll(form: ServerForm): Record<string, string> {
  const merged = { ...extraValidate(form), ...validateServerForm(form) }
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => Boolean(v)))
}

function Notice({ tone, children }: { tone: 'amber' | 'cyan'; children: React.ReactNode }) {
  const Icon = tone === 'amber' ? AlertTriangle : Info
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-xl border p-3.5 text-xs',
        tone === 'amber'
          ? 'border-amber-400/25 bg-amber-500/6 text-amber-200/90'
          : 'border-cyan-400/20 bg-cyan-500/5 text-cyan-100/80',
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>{children}</p>
    </div>
  )
}

export function ServerFormModal({
  open,
  server,
  onClose,
  onSaved,
}: {
  open: boolean
  /** null = add new, otherwise = edit */
  server: Server | null
  onClose: () => void
  onSaved: (server: Server, dns?: DnsInstructions) => void
}) {
  const toast = useToast()
  const { t } = useTranslation(['servers', 'common'])
  const [form, setForm] = useState<ServerForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  // When the user changes HTTPS by hand we stop auto-syncing it with the port
  const sslTouched = useRef(false)

  // Fill the form from the server when editing, reset it when adding
  useEffect(() => {
    if (!open) return
    setErrors({})
    setBusy(false)
    sslTouched.current = false
    setForm(
      server
        ? {
            domain: server.domain,
            originIp: server.originIp,
            originPort: String(server.originPort),
            sslEnabled: server.sslEnabled,
            mode: server.mode,
          }
        : EMPTY_FORM,
    )
  }, [open, server])

  const set = <K extends keyof ServerForm>(key: K, value: ServerForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key] || errors[FORM_ERROR_KEY]) {
      setErrors((e) => ({ ...e, [key]: '', [FORM_ERROR_KEY]: '' }))
    }
  }

  /** On create, HTTPS follows the port (the backend default: HTTPS unless port 80) */
  const onPortChange = (value: string) => {
    const port = value.trim()
    setForm((f) => ({
      ...f,
      originPort: value,
      ...(!server && !sslTouched.current && port !== '' ? { sslEnabled: port !== '80' } : {}),
    }))
    if (errors.originPort) setErrors((e) => ({ ...e, originPort: '' }))
  }

  // What will an edit change? (to warn before saving)
  const pending = useMemo(() => {
    if (!server) return null
    return {
      domain: normalizeDomain(form.domain) !== server.domain,
      origin:
        form.originIp.trim() !== server.originIp || form.originPort.trim() !== String(server.originPort),
      ssl: form.sslEnabled !== server.sslEnabled,
    }
  }, [form, server])

  const submit = async () => {
    if (busy) return

    const found = validateAll(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setBusy(true)
    try {
      const input = {
        domain: normalizeDomain(form.domain),
        originIp: form.originIp.trim(),
        originPort: Number(form.originPort),
        sslEnabled: form.sslEnabled,
        mode: form.mode,
      }

      if (server) {
        // Edit: send only the fields that changed (the backend body is strict)
        const patch: Partial<typeof input> = {}
        if (input.domain !== server.domain) patch.domain = input.domain
        if (input.originIp !== server.originIp) patch.originIp = input.originIp
        if (input.originPort !== server.originPort) patch.originPort = input.originPort
        if (input.sslEnabled !== server.sslEnabled) patch.sslEnabled = input.sslEnabled
        if (input.mode !== server.mode) patch.mode = input.mode

        if (Object.keys(patch).length === 0) {
          toast.info(t('form.toast.nothing'), t('form.toast.noChange'))
          setBusy(false)
          return
        }

        const res = await updateServer(server.id, patch)

        if (res.changes.length === 0) {
          toast.info(t('form.toast.nothing'), t('form.toast.same'))
        } else {
          toast.success(t('form.toast.updated'), input.domain)
        }

        // The backend tells us what the change reset
        if (res.resets.includes('dnsVerification')) {
          toast.info(t('form.toast.dnsReset'), t('form.toast.dnsResetDesc'))
        }
        if (res.resets.includes('originReachability')) {
          toast.info(t('form.toast.originReset'), t('form.toast.originResetDesc'))
        }

        onSaved(res.server, res.dns)
      } else {
        const res = await createServer(input)
        toast.success(t('form.toast.added'), t('form.toast.addedDesc'))
        onSaved(res.server, res.dns)
      }

      onClose()
    } catch (err) {
      const info = getApiErrorInfo(err)

      // Field errors from the backend: [{ field, message }] → { field: message }
      const fieldMap: Record<string, string> = {}
      for (const fe of info.fieldErrors) {
        const key = fe.field === '(body)' ? FORM_ERROR_KEY : fe.field
        if (!fieldMap[key]) fieldMap[key] = fe.message
      }
      setErrors(fieldMap)

      toast.error(server ? t('form.toast.updateFailed') : t('form.toast.addFailed'), info.message)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !busy) {
      e.preventDefault()
      void submit()
    }
  }

  const resolveError = (errKey?: string) => {
    if (!errKey) return undefined
    if (errKey.startsWith(VALIDATION_PREFIX)) {
      return t(errKey as never)
    }
    return errKey
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={server ? t('form.editTitle') : t('form.addTitle')}
      description={server ? t('form.editDesc') : t('form.addDesc')}
      icon={ServerIcon}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {server ? t('form.save') : t('form.add')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" onKeyDown={onKeyDown}>
        {errors[FORM_ERROR_KEY] && (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/6 px-4 py-3 text-sm text-rose-200">
            {resolveError(errors[FORM_ERROR_KEY])}
          </div>
        )}

        <Field
          label={t('form.domain.label')}
          error={resolveError(errors.domain)}
          hint={t('form.domain.hint')}
        >
          <TextInput
            icon={Globe}
            value={form.domain}
            invalid={Boolean(errors.domain)}
            disabled={busy}
            onChange={(e) => set('domain', e.target.value)}
            placeholder="shop.example.com"
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field
              label={t('form.originIp.label')}
              error={resolveError(errors.originIp)}
              hint={t('form.originIp.hint')}
            >
              <TextInput
                icon={ServerIcon}
                value={form.originIp}
                invalid={Boolean(errors.originIp)}
                disabled={busy}
                onChange={(e) => set('originIp', e.target.value)}
                placeholder="203.0.113.10"
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
              />
            </Field>
          </div>
          <Field label={t('form.port')} error={resolveError(errors.originPort)}>
            <TextInput
              inputMode="numeric"
              value={form.originPort}
              invalid={Boolean(errors.originPort)}
              disabled={busy}
              onChange={(e) => onPortChange(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="443"
              dir="ltr"
            />
          </Field>
        </div>

        <Field label={t('form.mode.label')} error={resolveError(errors.mode)}>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  value: 'PROTECT',
                  title: t('form.mode.protect.title'),
                  hint: t('form.mode.protect.hint'),
                },
                {
                  value: 'MONITOR_ONLY',
                  title: t('form.mode.monitor.title'),
                  hint: t('form.mode.monitor.hint'),
                },
              ] as const
            ).map((m) => (
              <button
                key={m.value}
                type="button"
                disabled={busy}
                onClick={() => set('mode', m.value)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-start transition',
                  form.mode === m.value
                    ? 'border-cyan-400/40 bg-cyan-500/10'
                    : 'border-white/10 bg-white/3 hover:border-white/20',
                )}
              >
                <p className={cn('text-sm font-medium', form.mode === m.value ? 'text-cyan-200' : 'text-slate-300')}>
                  {m.title}
                </p>
                <p className="text-xs text-slate-500">{m.hint}</p>
              </button>
            ))}
          </div>
          {!server && (
            <p className="mt-2 text-xs text-slate-500">
              {t('form.tip')}
            </p>
          )}
        </Field>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-white">{t('form.https.title')}</p>
            <p className="text-xs text-slate-500">{t('form.https.hint')}</p>
          </div>
          <Toggle
            checked={form.sslEnabled}
            onChange={(v) => {
              sslTouched.current = true
              set('sslEnabled', v)
            }}
            disabled={busy}
            label={t('form.https.title')}
          />
        </div>

        {/* What this edit will cause (from the backend’s behaviour) */}
        {pending?.domain && (
          <Notice tone="amber">
            {t('form.notice.domain')}
          </Notice>
        )}
        {pending?.origin && (
          <Notice tone="cyan">
            {t('form.notice.origin')}
          </Notice>
        )}
        {pending?.ssl && !pending.origin && (
          <Notice tone="cyan">{t('form.notice.ssl')}</Notice>
        )}
      </div>
    </Modal>
  )
}
