// frontend/src/pages/servers/DeleteModal.tsx — Delete سيرفر بConfirm الدومين

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useToast } from '../../components/ui/Toast'
import { Button, Field, Modal, TextInput } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { deleteServer, type Server } from '../../services/serversService'


// ==================================================================
// Delete modal (Noزم يكتب الدومين)
// ==================================================================

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

  const matches = server !== null && confirmText.trim().toLowerCase() === server.domain.toLowerCase()

  const submit = async () => {
    if (!server || !matches) return
    setBusy(true)
    try {
      const res = await deleteServer(server.id, server.domain)
      toast.success(res.message, `${res.data.deletedEvents.toLocaleString('en-US')} related events removed`)
      onDeleted(server.id)
      onClose()
    } catch (err) {
      toast.error('Could not delete server', parseApiError(err).message)
    } finally {
      setBusy(false)
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
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" icon={Trash2} loading={busy} disabled={!matches} onClick={() => void submit()}>
            Delete permanently
          </Button>
        </>
      }
    >
      <Field label={`Type "${server?.domain ?? ''}" to confirm`}>
        <TextInput
          value={confirmText}
          disabled={busy}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={server?.domain}
          autoComplete="off"
        />
      </Field>
    </Modal>
  )
}
