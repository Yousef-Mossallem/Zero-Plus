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
import { useTranslation } from 'react-i18next'

import { Button, Field, Modal, SelectInput, TextInput } from '../../components/ui/kit'
import { parseApiError } from '../../services/apiError'
import { createReport, type CreatedReport, type ReportType } from '../../services/reportsService'
import type { Server } from '../../services/serversService'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../utils/format'
import { TYPE_LABEL, toLocalInput } from './shared'

const DAY = 24 * 60 * 60 * 1000

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
  const { t } = useTranslation(['reports', 'common'])
  const toast = useToast()

  const PRESETS = [
    { label: t('reports:modal.presets.h24', 'Last 24h'), ms: DAY },
    { label: t('reports:modal.presets.d7', 'Last 7 days'), ms: 7 * DAY },
    { label: t('reports:modal.presets.d30', 'Last 30 days'), ms: 30 * DAY },
  ]
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
    if (!start || Number.isNaN(s)) e.periodStart = t('reports:validation.startRequired', 'Start date is required')
    if (!end || Number.isNaN(en)) e.periodEnd = t('reports:validation.endRequired', 'End date is required')
    if (!e.periodStart && !e.periodEnd) {
      if (en <= s) e.periodEnd = t('reports:validation.endAfterStart', 'End must be after start')
      else if (en - s > 31 * DAY) e.periodEnd = t('reports:validation.maxDays', 'The period cannot exceed 31 days')
      if (s < Date.now() - 365 * DAY) e.periodStart = t('reports:validation.maxPast', 'Cannot go back more than 365 days')
    }
    if (title.trim() && (title.trim().length < 3 || title.trim().length > 200)) {
      e.title = t('reports:validation.titleLength', 'Title must be 3 – 200 characters')
    }
    if (type === 'INCIDENT' && eventId.trim() && !/^[0-9a-f-]{36}$/i.test(eventId.trim())) {
      e.securityEventId = t('reports:validation.eventIdInvalid', 'Enter a valid event ID (UUID)')
    }
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
      toast.success(t('reports:toast.requested', 'Report requested'), res.message)
      onCreated(res.report)
      onClose()
    } catch (err) {
      const parsed = parseApiError(err)
      setErrors(parsed.fieldErrors)
      toast.error(t('reports:toast.createFailed', 'Could not create the report'), parsed.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={t('reports:modal.title', 'New report')}
      description={t('reports:modal.description', "The report is generated in the background. You'll see its status update live.")}
      icon={FilePlus2}
      tone="cyan"
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('reports:modal.cancel', 'Cancel')}</Button>
          <Button variant="primary" icon={FilePlus2} loading={busy} onClick={() => void submit()}>{t('reports:modal.generate', 'Generate')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('reports:modal.type', 'Type')} error={errors.type}>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_LABEL) as ReportType[]).map((tType) => (
              <button
                key={tType}
                type="button"
                disabled={busy}
                onClick={() => setType(tType)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-sm font-medium',
                  type === tType ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200' : 'border-white/10 bg-white/3 text-slate-400 hover:border-white/20',
                )}
              >
                {TYPE_LABEL[tType]}
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
          <Field label={t('reports:modal.from', 'From')} error={errors.periodStart}>
            <TextInput type="datetime-local" value={start} invalid={Boolean(errors.periodStart)} disabled={busy} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('reports:modal.to', 'To')} error={errors.periodEnd}>
            <TextInput type="datetime-local" value={end} invalid={Boolean(errors.periodEnd)} disabled={busy} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label={`${t('reports:modal.server', 'Server')} (${t('reports:modal.optional', 'optional')})`} error={errors.serverId} hint="Leave empty for the whole organization">
          <SelectInput value={serverId} disabled={busy} onChange={(e) => setServerId(e.target.value)}>
            <option value="">{t('reports:page.allServers', 'All servers')}</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0b1224]">{s.domain}</option>
            ))}
          </SelectInput>
        </Field>

        <Field label={`${t('reports:modal.reportTitle', 'Report title')} (${t('reports:modal.optional', 'optional')})`} error={errors.title}>
          <TextInput value={title} invalid={Boolean(errors.title)} disabled={busy} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t('reports:modal.reportTitlePlaceholder', 'e.g. Weekly security summary')} />
        </Field>

        {type === 'INCIDENT' && (
          <Field label={`${t('reports:modal.eventId', 'Security event ID')} (${t('reports:modal.optional', 'optional')})`} error={errors.securityEventId} hint={t('reports:modal.eventIdHint', 'Link the report to a specific event')}>
            <TextInput value={eventId} invalid={Boolean(errors.securityEventId)} disabled={busy} onChange={(e) => setEventId(e.target.value)} placeholder={t('reports:modal.eventIdPlaceholder', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')} />
          </Field>
        )}
      </div>
    </Modal>
  )
}
