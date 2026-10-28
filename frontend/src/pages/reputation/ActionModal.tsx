// frontend/src/pages/reputation/ActionModal.tsx — مودال الحظر / رفع الحظر / التصفير

import { useEffect, useState } from 'react'
import { Ban, RotateCcw, Unlock } from 'lucide-react'
import { Button, Field, Modal, TextArea, TextInput, type Tone } from '../../components/ui/kit'
import { type BanInput, type ReputationEntry } from '../../services/reputationService'
import { cn } from '../../utils/format'
import { BAN_PRESETS } from './shared'


// ==================================================================
// Action Modal (ban / unban / reset)
// ==================================================================

export type ActionKind = 'ban' | 'unban' | 'reset'

export function ActionModal({
  kind,
  entry,
  onClose,
  onBan,
  onUnban,
  onReset,
}: {
  kind: ActionKind | null
  entry: ReputationEntry | null
  onClose: () => void
  onBan: (input: BanInput) => Promise<boolean>
  onUnban: (input: { reason?: string; resetScore: boolean }) => Promise<boolean>
  onReset: (reason?: string) => Promise<boolean>
}) {
  const [banType, setBanType] = useState<'TEMPORARY' | 'PERMANENT'>('TEMPORARY')
  const [minutes, setMinutes] = useState('120')
  const [reason, setReason] = useState('')
  const [resetScore, setResetScore] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // كل ما المودال يتفتح من جديد نرجّع الفورم لحالته الأولى
  useEffect(() => {
    if (kind) {
      setBanType('TEMPORARY')
      setMinutes('120')
      setReason('')
      setResetScore(false)
      setConfirmed(false)
      setErrors({})
      setBusy(false)
    }
  }, [kind, entry?.id])

  if (!kind || !entry) return null

  const submit = async () => {
    const next: Record<string, string> = {}
    const trimmed = reason.trim()

    // نفس قواعد الباك (manualBanBodySchema): السبب 3-300 حرف، الدقائق 1-43200
    if (kind === 'ban') {
      if (trimmed.length < 3) next.reason = 'Reason must be at least 3 characters'
      if (trimmed.length > 300) next.reason = 'Reason must be at most 300 characters'
      if (banType === 'TEMPORARY') {
        const m = Number(minutes)
        if (!Number.isInteger(m) || m < 1 || m > 43_200) next.minutes = 'Enter 1 – 43,200 minutes'
      }
    } else if (trimmed && (trimmed.length < 3 || trimmed.length > 300)) {
      next.reason = 'Reason must be 3 – 300 characters'
    }
    if (kind === 'reset' && !confirmed) next.confirm = 'Please confirm to continue'

    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    let ok = false
    if (kind === 'ban') {
      ok = await onBan(
        banType === 'PERMANENT'
          ? { type: 'PERMANENT', reason: trimmed }
          : { type: 'TEMPORARY', minutes: Number(minutes), reason: trimmed },
      )
    } else if (kind === 'unban') {
      ok = await onUnban({ ...(trimmed && { reason: trimmed }), resetScore })
    } else {
      ok = await onReset(trimmed || undefined)
    }
    setBusy(false)
    if (ok) onClose()
  }

  const META = {
    ban: { title: 'Ban device', icon: Ban, tone: 'rose' as Tone, cta: 'Apply ban', variant: 'danger' as const },
    unban: { title: 'Lift ban', icon: Unlock, tone: 'emerald' as Tone, cta: 'Lift ban', variant: 'success' as const },
    reset: { title: 'Reset reputation', icon: RotateCcw, tone: 'amber' as Tone, cta: 'Reset', variant: 'danger' as const },
  }[kind]

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={META.title}
      icon={META.icon}
      tone={META.tone}
      description={`${entry.ipAddress}${entry.countryCode ? ` · ${entry.countryCode}` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={META.variant} loading={busy} onClick={() => void submit()}>
            {META.cta}
          </Button>
        </>
      }
    >
      {/* ---------------- Ban fields ---------------- */}
      {kind === 'ban' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(['TEMPORARY', 'PERMANENT'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setBanType(t)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-sm font-medium',
                  banType === t
                    ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                    : 'border-white/10 bg-white/3 text-slate-400 hover:border-white/20',
                )}
              >
                {t === 'TEMPORARY' ? 'Temporary' : 'Permanent'}
              </button>
            ))}
          </div>

          {banType === 'TEMPORARY' && (
            <Field label="Duration (minutes)" error={errors.minutes}>
              <div className="mb-2 flex flex-wrap gap-2">
                {BAN_PRESETS.map((p) => (
                  <button
                    key={p.minutes}
                    type="button"
                    onClick={() => setMinutes(String(p.minutes))}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-xs',
                      Number(minutes) === p.minutes
                        ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300'
                        : 'border-white/10 text-slate-400 hover:border-white/20',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <TextInput
                type="number"
                min={1}
                max={43200}
                value={minutes}
                invalid={Boolean(errors.minutes)}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </Field>
          )}
        </>
      )}

      {/* ---------------- Reason (All types) ---------------- */}
      <Field
        label={kind === 'ban' ? 'Reason' : 'Reason (optional)'}
        error={errors.reason}
        hint="Saved in the audit trail"
      >
        <TextArea
          rows={3}
          maxLength={300}
          value={reason}
          invalid={Boolean(errors.reason)}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            kind === 'ban' ? 'e.g. Repeated credential stuffing on /login' : 'Add a short note…'
          }
        />
      </Field>

      {kind === 'unban' && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 bg-white/3 p-3.5">
          <input
            type="checkbox"
            checked={resetScore}
            onChange={(e) => setResetScore(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-cyan-400"
          />
          <span className="text-sm text-slate-300">
            Also reset the reputation score
            <span className="block text-xs text-slate-500">
              Otherwise the device may be re-banned quickly if its score is still high.
            </span>
          </span>
        </label>
      )}

      {kind === 'reset' && (
        <div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3.5">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-400"
            />
            <span className="text-sm text-slate-300">
              I understand this clears the score and lifts any ban on this device.
            </span>
          </label>
          {errors.confirm && <p className="mt-1.5 text-xs text-rose-400">{errors.confirm}</p>}
        </div>
      )}
    </Modal>
  )
}
