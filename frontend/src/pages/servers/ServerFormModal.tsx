// frontend/src/pages/servers/ServerFormModal.tsx — إضافة / تعديل سيرفر

import { useEffect, useState } from 'react'
import { Globe, Plus, Server as ServerIcon } from 'lucide-react'
import { useToast } from '../../components/ui/Toast'
import { Button, Field, Modal, TextInput, Toggle } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { createServer, updateServer, type DnsInstructions, type Server } from '../../services/serversService'
import { cn } from '../../utils/format'
import { EMPTY_FORM, validateServerForm, type ServerForm } from './shared'


// ==================================================================
// Add / Edit modal
// ==================================================================

export function ServerFormModal({
  open,
  server,
  onClose,
  onSaved,
}: {
  open: boolean
  /** null = إضافة جديدة، غير كده = تعديل */
  server: Server | null
  onClose: () => void
  onSaved: (server: Server, dns?: DnsInstructions) => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<ServerForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  // نملى الفورم من السيرفر لما نفتح للتعديل، ونفضيه للإضافة
  useEffect(() => {
    if (!open) return
    setErrors({})
    setBusy(false)
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
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }))
  }

  const submit = async () => {
    const found = validateServerForm(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setBusy(true)
    try {
      const input = {
        domain: form.domain.trim(),
        originIp: form.originIp.trim(),
        originPort: Number(form.originPort),
        sslEnabled: form.sslEnabled,
        mode: form.mode,
      }

      if (server) {
        // تعديل: بنبعت الحقول اللي اتغيرت بس
        const patch: Partial<typeof input> = {}
        if (input.domain !== server.domain) patch.domain = input.domain
        if (input.originIp !== server.originIp) patch.originIp = input.originIp
        if (input.originPort !== server.originPort) patch.originPort = input.originPort
        if (input.sslEnabled !== server.sslEnabled) patch.sslEnabled = input.sslEnabled
        if (input.mode !== server.mode) patch.mode = input.mode

        if (Object.keys(patch).length === 0) {
          toast.info('Nothing to update', 'No fields were changed')
          setBusy(false)
          return
        }

        const res = await updateServer(server.id, patch)
        toast.success(res.message)
        // الباك بيقول لو التعديل صفّر التحقق، فنبلّغ المستخدم
        if (res.resets.includes('dnsVerification')) {
          toast.warning('DNS verification was reset', 'Add the new TXT record and verify again.')
        }
        onSaved(res.server, res.dns)
      } else {
        const res = await createServer(input)
        toast.success('Server added', 'Follow the DNS steps to activate protection.')
        onSaved(res.server, res.dns)
      }
      onClose()
    } catch (err) {
      const parsed = parseApiError(err)
      // أخطاء الحقول من الباك (domain / originIp / originPort ...)
      setErrors(parsed.fieldErrors)
      toast.error(server ? 'Could not update server' : 'Could not add server', parsed.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={server ? 'Edit server' : 'Add protected server'}
      description={
        server
          ? 'Changing the domain requires verifying DNS ownership again.'
          : 'Traffic for this domain will pass through the Zero Plus Gateway.'
      }
      icon={ServerIcon}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {server ? 'Save changes' : 'Add server'}
          </Button>
        </>
      }
    >
      <Field label="Domain" error={errors.domain} hint="e.g. shop.example.com — no http:// and no port">
        <TextInput
          icon={Globe}
          value={form.domain}
          invalid={Boolean(errors.domain)}
          disabled={busy}
          onChange={(e) => set('domain', e.target.value)}
          placeholder="shop.example.com"
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Origin IP" error={errors.originIp} hint="The real server's IPv4 address">
            <TextInput
              icon={ServerIcon}
              value={form.originIp}
              invalid={Boolean(errors.originIp)}
              disabled={busy}
              onChange={(e) => set('originIp', e.target.value)}
              placeholder="203.0.113.10"
              autoComplete="off"
            />
          </Field>
        </div>
        <Field label="Port" error={errors.originPort}>
          <TextInput
            inputMode="numeric"
            value={form.originPort}
            invalid={Boolean(errors.originPort)}
            disabled={busy}
            onChange={(e) => set('originPort', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Mode">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: 'PROTECT', title: 'Protect', hint: 'Block and rate-limit' },
              { value: 'MONITOR_ONLY', title: 'Monitor only', hint: 'Log decisions, enforce nothing' },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              disabled={busy}
              onClick={() => set('mode', m.value)}
              className={cn(
                'rounded-xl border px-4 py-3 text-left',
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
      </Field>

      <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/3 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">Origin uses HTTPS</p>
          <p className="text-xs text-slate-500">Turn off if the origin only speaks plain HTTP.</p>
        </div>
        <Toggle checked={form.sslEnabled} onChange={(v) => set('sslEnabled', v)} disabled={busy} label="Origin uses HTTPS" />
      </div>
    </Modal>
  )
}
