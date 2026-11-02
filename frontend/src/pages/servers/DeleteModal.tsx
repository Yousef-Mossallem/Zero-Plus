// frontend/src/pages/servers/DeleteModal.tsx — Delete a server (confirm by typing the domain)

import { useEffect, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useToast } from '../../components/ui/Toast'
import { Button, Field, Modal, TextInput } from '../../components/ui/kit'
import { deleteServer, getApiErrorInfo, type Server } from '../../services/serversService'

// ==================================================================
// Delete modal
//   DELETE /servers/:id?confirmDomain=<domain>   (OWNER / ADMIN)
//   → { success, message, data: { id, domain, deletedEvents } }
//
// The user must type the exact domain. The backend lowercases it and strips a
// trailing dot / port, so the check here uses the same normalisation.
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
      toast.success('Server deleted', `${server.domain} · ${events.toLocaleString('en-US')} related events removed`)
      onDeleted(server.id)
      onClose()
    } catch (err) {
      const info = getApiErrorInfo(err)

      // Already gone (deleted by someone else): treat it as done and refresh the list
      if (info.status === 404) {
        toast.info('Server already deleted', server.domain)
        onDeleted(server.id)
        onClose()
        return
      }

      toast.error('Could not delete server', info.message)
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
      title="Delete server"
      description="This stops protection for the domain and permanently deletes its security events."
      icon={Trash2}
      tone="rose"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} loading={busy} disabled={!matches} onClick={() => void submit()}>
            Delete permanently
          </Button>
        </>
      }
    >
      <div className="space-y-4" onKeyDown={onKeyDown}>
        {server && (
          <div className="rounded-xl border border-white/8 bg-white/3 px-4 py-3">
            <p dir="ltr" className="break-all text-sm font-semibold text-white">
              {server.domain}
            </p>
            <p dir="ltr" className="mt-0.5 font-mono text-xs text-slate-500">
              Origin {server.originIp}:{server.originPort}
            </p>
          </div>
        )}

        <div className="flex gap-2.5 rounded-xl border border-amber-400/25 bg-amber-500/6 p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-xs text-amber-200/90">
            If your DNS still points to the Gateway, visitors will stop reaching your site after deletion. Point the
            domain back to your origin server (or remove the Gateway records) as part of this change.
          </p>
        </div>

        <Field label={`Type "${server?.domain ?? ''}" to confirm`}>
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