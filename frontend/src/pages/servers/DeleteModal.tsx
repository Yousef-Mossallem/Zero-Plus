// frontend/src/pages/servers/DeleteModal.tsx — Delete a server (confirm by typing the domain)

import { useEffect, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../components/ui/Toast'
import { Button, Field, Modal, TextInput } from '../../components/ui/kit'
import { deleteServer, getApiErrorInfo, type Server } from '../../services/serversService'

// ==================================================================
// Delete modal
// DELETE /servers/:id?confirmDomain=<domain> (OWNER / ADMIN)
// → { success, message, data: { id, domain, deletedEvents } }
//
// The user must type the exact domain. The backend lowercases it and strips a
// trailing dot / port, so the check here uses the same normalisation.
//
// i18n: النصوص من servers.delete، والدومين/الـ IP بيفضلوا LTR.
// ==================================================================

const normalize = (raw: string) => raw.trim().toLowerCase().replace(/\.$/, '')

export function DeleteModal({
  server,
  onClose,
  onDeleted,
}: {
  server: Server | null
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const toast = useToast()
  const { t } = useTranslation(['servers', 'common'])
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setConfirmText('')
    setBusy(false)
  }, [server?.id])

  const matches = server !== null && normalize(confirmText) === normalize(server.domain)

  const submit = async () => {
    if (!server || !matches || busy) return
    setBusy(true)
    try {
      const res = await deleteServer(server.id, server.domain)
      const events = res.data.deletedEvents ?? 0
      toast.success(
        t('delete.toast.deleted'),
        t('delete.toast.deletedDesc', { domain: server.domain, n: events.toLocaleString('en-US') }),
      )
      onDeleted(server.id)
      onClose()
    } catch (err) {
      const info = getApiErrorInfo(err)
      // Already gone (deleted by someone else): treat it as done and refresh the list
      if (info.status === 404) {
        toast.info(t('delete.toast.already'), server.domain)
        onDeleted(server.id)
        onClose()
        return
      }
      toast.error(t('delete.toast.failed'), info.message)
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <Modal
      open={server !== null}
      onClose={busy ? () => {} : onClose}
      title={t('delete.title')}
      description={t('delete.description')}
      icon={Trash2}
      tone="rose"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
          <Button variant="danger" icon={Trash2} loading={busy} disabled={!matches} onClick={() => void submit()}>
            {t('delete.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" onKeyDown={onKeyDown}>
        {server && (
          <div className="rounded-xl border border-white/8 bg-white/3 px-4 py-3">
            <p dir="ltr" className="break-all text-start text-sm font-semibold text-white">
              {server.domain}
            </p>
            <p dir="ltr" className="mt-0.5 text-start font-mono text-xs text-slate-500">
              {t('delete.origin', { addr: `${server.originIp}:${server.originPort}` })}
            </p>
          </div>
        )}

        <div className="flex gap-2.5 rounded-xl border border-amber-400/25 bg-amber-500/6 p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-xs text-amber-200/90">{t('delete.warning')}</p>
        </div>

        <Field label={t('delete.typeToConfirm', { domain: server?.domain ?? '' })}>
          <TextInput
            value={confirmText}
            disabled={busy}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={server?.domain}
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
          />
        </Field>
      </div>
    </Modal>
  )
}
