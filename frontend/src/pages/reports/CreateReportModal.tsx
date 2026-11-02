// frontend/src/pages/reports/CreateReportModal.tsx
// ==================================================================
// فورم إنشاء تقرير → POST /reports
// الحقول: type • periodStart/periodEnd • serverId (اختياري) • title (اختياري)
//         • securityEventId (لتقارير INCIDENT)
// قيود الباك (بنتحقق منها هنا للراحة، والباك هو الحكم النهائي):
//   periodEnd بعد periodStart • الفترة ≤ 31 يوم • مش أقدم من 365 يوم
// أخطاء الباك (400 VALIDATION_ERROR) بتتعرض جنب الحقل المعني.
// ==================================================================

import { useEffect, useState } from 'react'
import { FilePlus2 } from 'lucide-react'

import { Button, Field, Modal, SelectInput, TextInput } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { createReport, type CreatedReport, type ReportType } from '../../services/reportsService'
import type { Server } from '../../services/serversService'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../utils/format'
import { TYPE_LABEL, toLocalInput } from './shared'

const DAY = 24 * 60 * 60 * 1000
const PRESETS = [
  { label: 'Last 24h', ms: DAY },
  { label: 'Last 7 days', ms: 7 * DAY },
  { label: 'Last 30 days', ms: 30 * DAY },
]

export default function CreateReportModal({
  open,
  servers,
  onClose,
  onCreated,
}: {
  open: boolean
  servers: Server[]
  onClose: () => void
  onCreated: (report: CreatedReport) => void
}) {
  const toast = useToast()
  const [type, setType] = useState<ReportType>('ON_DEMAND')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [serverId, setServerId] = useState('')
  const [title, setTitle] = useState('')
  const [eventId, setEventId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const applyPreset = (ms: number) => {
    const now = new Date()
    setEnd(toLocalInput(now))
    setStart(toLocalInput(new Date(now.getTime() - ms)))
    setErrors((e) => ({ ...e, periodStart: '', periodEnd: '' }))
  }

  // كل فتح جديد = فورم نضيف وافتراضي آخر 24 ساعة
  useEffect(() => {
    if (!open) return
    setType('ON_DEMAND')
    setServerId('')
    setTitle('')
    setEventId('')
    setErrors({})
    setBusy(false)
    applyPreset(DAY)
  }, [open])

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {}
    const s = new Date(start).getTime()
    const en = new Date(end).getTime()
    if (!start || Number.isNaN(s)) e.periodStart = 'Start date is required'
    if (!end || Number.isNaN(en)) e.periodEnd = 'End date is required'
    if (!e.periodStart && !e.periodEnd) {
      if (en <= s) e.periodEnd = 'End must be after start'
      else if (en - s > 31 * DAY) e.periodEnd = 'The period cannot exceed 31 days'
      if (s < Date.now() - 365 * DAY) e.periodStart = 'Cannot go back more than 365 days'
    }
    if (title.trim() && (title.trim().length < 3 || title.trim().length > 200)) e.title = 'Title must be 3 – 200 characters'
    if (type === 'INCIDENT' && eventId.trim() && !/^[0-9a-f-]{36}$/i.test(eventId.trim())) e.securityEventId = 'Enter a valid event ID (UUID)'
    return e
  }

  const submit = async () => {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      const res = await createReport({
        type,
        periodStart: new Date(start).toISOString(),
        periodEnd: new Date(end).toISOString(),
        ...(serverId && { serverId }),
        ...(title.trim() && { title: title.trim() }),
        ...(type === 'INCIDENT' && eventId.trim() && { securityEventId: eventId.trim() }),
      })
      toast.success('Report requested', res.message)
      onCreated(res.report)
      onClose()
    } catch (err) {
      const parsed = parseApiError(err)
      setErrors(parsed.fieldErrors)
      toast.error('Could not create the report', parsed.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="New report"
      description="The report is generated in the background. You'll see its status update live."
      icon={FilePlus2}
      tone="cyan"
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={FilePlus2} loading={busy} onClick={() => void submit()}>Generate</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Type" error={errors.type}>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_LABEL) as ReportType[]).map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => setType(t)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-sm font-medium',
                  type === t ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200' : 'border-white/10 bg-white/3 text-slate-400 hover:border-white/20',
                )}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </Field>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => applyPreset(p.ms)}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-400 hover:border-cyan-400/30 hover:text-cyan-200">
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="From" error={errors.periodStart}>
            <TextInput type="datetime-local" value={start} invalid={Boolean(errors.periodStart)} disabled={busy} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To" error={errors.periodEnd}>
            <TextInput type="datetime-local" value={end} invalid={Boolean(errors.periodEnd)} disabled={busy} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label="Server (optional)" error={errors.serverId} hint="Leave empty for the whole organization">
          <SelectInput value={serverId} disabled={busy} onChange={(e) => setServerId(e.target.value)}>
            <option value="">All servers</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0b1224]">{s.domain}</option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Title (optional)" error={errors.title}>
          <TextInput value={title} invalid={Boolean(errors.title)} disabled={busy} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly security summary" />
        </Field>

        {type === 'INCIDENT' && (
          <Field label="Security event ID (optional)" error={errors.securityEventId} hint="Link the report to a specific event">
            <TextInput value={eventId} invalid={Boolean(errors.securityEventId)} disabled={busy} onChange={(e) => setEventId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          </Field>
        )}
      </div>
    </Modal>
  )
}
