// frontend/src/pages/simulation/SettingsPanel.tsx
// ==================================================================
// Simulation Settings + Advanced Settings (collapsed by default)
// ==================================================================

import {
  AlertTriangle,
  ChevronDown,
  Info,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  Field,
  SelectInput,
  Skeleton,
  TextInput,
  Toggle,
} from '../../components/ui/kit'
import type { Server } from '../../services/serversService'
import type {
  AiMode,
  Intensity,
  PersonaKey,
  SimulationPattern,
} from '../../services/simulationsService'
import { cn } from '../../utils/format'
import {
  MAX_DURATION_SEC,
  MAX_RPS_LIMIT,
  MIN_DURATION_SEC,
  PATTERNS,
  PERSONAS,
  weightsTotal,
  type DurationUnit,
  type FormErrors,
  type SimForm,
} from './shared'

interface SettingsPanelProps {
  form: SimForm
  setForm: Dispatch<SetStateAction<SimForm>>
  errors: FormErrors
  formError: string | null
  servers: Server[]
  serversLoading: boolean
  serversError: string | null
  onRetryServers: () => void
  /** RUNNING: settings that affect the current run are locked */
  locked: boolean
  advancedOpen: boolean
  onToggleAdvanced: () => void
  onPatternChange: (pattern: SimulationPattern) => void
  onCustomize: () => void
  onReset: () => void
}

const INTENSITIES: Intensity[] = ['low', 'medium', 'high']
const AI_MODES: AiMode[] = ['auto', 'fixed', 'off']

/** Human readable total for the duration hint (e.g. "= 90s" / "= 2m 30s") */
function formatTotalDuration(value: string, unit: DurationUnit): string | null {
  const n = Number(value)
  if (value.trim() === '' || !Number.isFinite(n) || n <= 0) return null
  const sec = Math.round(unit === 'min' ? n * 60 : n)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

// ------------------------------------------------------------------
// Persona weights editor
// ------------------------------------------------------------------

function WeightsEditor({
  form,
  setForm,
  disabled,
  error,
}: {
  form: SimForm
  setForm: Dispatch<SetStateAction<SimForm>>
  disabled: boolean
  error: string | undefined
}) {
  const { t } = useTranslation('simulation')
  const total = weightsTotal(form.weights)

  const setWeight = (key: PersonaKey, raw: string) => {
    const n = raw.trim() === '' ? 0 : Math.round(Number(raw))
    const value = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
    setForm((f) => ({ ...f, weights: { ...f.weights, [key]: value } }))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400/90">
            {t('settings.personaWeights')}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {t('settings.personaWeightsHint')}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {t('settings.totalWeights')}{' '}
          <span
            className={cn(
              'font-semibold tabular-nums',
              total > 0 ? 'text-slate-300' : 'text-rose-400',
            )}
          >
            {total}
          </span>
        </p>
      </div>

      <div className="space-y-2.5">
        {PERSONAS.map((p) => {
          const weight = form.weights[p.key]
          const pct = total > 0 ? Math.round((weight / total) * 100) : 0

          return (
            <div
              key={p.key}
              className={cn(
                'grid grid-cols-1 items-center gap-3 rounded-xl border border-white/6 bg-white/2 px-4 py-3.5 transition-opacity md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto]',
                disabled && 'opacity-80',
              )}
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-white">{p.key}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                  {p.description}
                </p>
              </div>

              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={weight}
                disabled={disabled}
                onChange={(e) => setWeight(p.key, e.target.value)}
                aria-label={`${p.key} weight`}
                className="h-1.5 w-full min-w-0 cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              />

              <div className="flex items-center justify-between gap-2.5 md:justify-end">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={weight}
                  disabled={disabled}
                  onChange={(e) => setWeight(p.key, e.target.value)}
                  aria-label={`${p.key} weight value`}
                  className="w-16 rounded-lg border border-white/10 bg-white/4 px-2 py-1.5 text-center text-sm tabular-nums text-white outline-none transition-colors focus:border-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="w-11 text-right text-xs tabular-nums text-slate-500">
                  {pct}%
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  )
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------

export default function SettingsPanel({
  form,
  setForm,
  errors,
  formError,
  servers,
  serversLoading,
  serversError,
  onRetryServers,
  locked,
  advancedOpen,
  onToggleAdvanced,
  onPatternChange,
  onCustomize,
  onReset,
}: SettingsPanelProps) {
  const { t } = useTranslation('simulation')
  const selected = servers.find((s) => s.id === form.serverId)
  const hasOnline = servers.some((s) => s.status === 'ONLINE')
  const patternMeta = PATTERNS.find((p) => p.value === form.pattern)
  const isCustom = form.pattern === 'custom'

  const totalLabel = formatTotalDuration(form.durationValue, form.durationUnit)
  const durationHint = `${t('settings.durationHint', { min: MIN_DURATION_SEC, max: MAX_DURATION_SEC })}${
    totalLabel ? ` · = ${totalLabel}` : ''
  }`

  const patch = <K extends keyof SimForm>(key: K, value: SimForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  return (
    <Card className="overflow-hidden p-0" delay={40} accent>
      {/* ---------- Header ---------- */}
      <div className="flex flex-col gap-4 border-b border-white/6 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">{t('settings.title')}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t('settings.subtitle')}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" icon={SlidersHorizontal} disabled={locked} onClick={onCustomize}>
            {t('patterns.custom.label')}
          </Button>
          <Button size="sm" icon={RotateCcw} disabled={locked} onClick={onReset}>
            {t('page.resetDefaults')}
          </Button>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        {/* ---------- Locked note ---------- */}
        {locked && (
          <div className="flex items-start gap-3 rounded-xl border border-cyan-400/20 bg-cyan-500/6 px-4 py-3.5 text-sm text-cyan-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 leading-relaxed">
              {t('settings.lockedHint')}
            </p>
          </div>
        )}

        {/* ---------- Form error (backend: 409 / 404 / 400) ---------- */}
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3.5 text-sm text-rose-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 leading-relaxed">{formError}</p>
          </div>
        )}

        {/* ---------- No ONLINE server ---------- */}
        {!serversLoading && !serversError && !hasOnline && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 leading-relaxed">
              {servers.length === 0
                ? t('settings.noServers')
                : t('settings.noOnlineServer')}{' '}
              <Link
                to="/servers"
                className="font-semibold underline underline-offset-2 hover:text-white"
              >
                {t('settings.openServers')}
              </Link>
            </p>
          </div>
        )}

        {/* ---------- Core fields ---------- */}
        <div className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {/* Server */}
          <div className="min-w-0">
            <Field label={t('page.targetServer')} error={errors.serverId}>
              {serversLoading ? (
                <Skeleton className="h-11 w-full rounded-xl" />
              ) : serversError ? (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
                  <span className="min-w-0 flex-1 truncate" title={serversError}>
                    {serversError}
                  </span>
                  <button
                    type="button"
                    onClick={onRetryServers}
                    className="shrink-0 font-semibold underline"
                  >
                    {t('settings.retry')}
                  </button>
                </div>
              ) : (
                <SelectInput
                  value={form.serverId}
                  invalid={Boolean(errors.serverId)}
                  disabled={locked || servers.length === 0}
                  onChange={(e) => patch('serverId', e.target.value)}
                >
                  <option value="" className="bg-[#0b1224]">
                    {servers.length === 0 ? t('settings.noServers') : t('page.selectServer')}
                  </option>
                  {servers.map((s) => (
                    <option
                      key={s.id}
                      value={s.id}
                      disabled={s.status !== 'ONLINE'}
                      className="bg-[#0b1224]"
                    >
                      {s.domain} — {s.status}
                    </option>
                  ))}
                </SelectInput>
              )}

              {selected?.mode === 'MONITOR_ONLY' && (
                <div className="mt-2.5 space-y-1.5">
                  <Badge tone="amber" dot>
                    {t('settings.monitorOnlyBadge')}
                  </Badge>
                  <p className="text-xs leading-relaxed text-amber-300/90">
                    {t('settings.monitorOnlyHint')}
                  </p>
                </div>
              )}
            </Field>
          </div>

          {/* Pattern */}
          <div className="min-w-0">
            <Field label={t('page.pattern')}>
              <SelectInput
                value={form.pattern}
                disabled={locked}
                onChange={(e) => onPatternChange(e.target.value as SimulationPattern)}
              >
                {PATTERNS.map((p) => (
                  <option key={p.value} value={p.value} className="bg-[#0b1224]">
                    {p.label}
                  </option>
                ))}
              </SelectInput>
              {patternMeta && (
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  {patternMeta.description}
                </p>
              )}
            </Field>
          </div>

          {/* Intensity */}
          <div className="min-w-0">
            <Field
              label={t('settings.intensity')}
              hint={t('settings.intensityHint')}
            >
              <SelectInput
                value={form.intensity}
                disabled={locked}
                onChange={(e) => patch('intensity', e.target.value as Intensity)}
              >
                {INTENSITIES.map((i) => {
                  const labelMap: Record<Intensity, string> = {
                    low: t('settings.intensityLow'),
                    medium: t('settings.intensityMedium'),
                    high: t('settings.intensityHigh'),
                  }
                  return (
                    <option key={i} value={i} className="bg-[#0b1224]">
                      {labelMap[i] || i}
                    </option>
                  )
                })}
              </SelectInput>
            </Field>
          </div>

          {/* Duration — input takes the free space, unit select is auto width */}
          <div className="min-w-0">
            <Field label={t('settings.duration')} error={errors.durationValue} hint={durationHint}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <div className="min-w-0">
                  <TextInput
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={form.durationValue}
                    invalid={Boolean(errors.durationValue)}
                    disabled={locked}
                    onChange={(e) => patch('durationValue', e.target.value)}
                  />
                </div>
                <div className="w-auto">
                  <SelectInput
                    className="w-auto min-w-28"
                    value={form.durationUnit}
                    disabled={locked}
                    onChange={(e) => patch('durationUnit', e.target.value as DurationUnit)}
                    aria-label={t('settings.duration')}
                  >
                    <option value="sec" className="bg-[#0b1224]">
                      {t('settings.durationSeconds')}
                    </option>
                    <option value="min" className="bg-[#0b1224]">
                      {t('settings.durationMinutes')}
                    </option>
                  </SelectInput>
                </div>
              </div>
            </Field>
          </div>

          {/* Target RPS */}
          <div className="min-w-0">
            <Field
              label={t('settings.targetRps')}
              error={errors.targetRps}
              hint={t('settings.targetRpsHint')}
            >
              <TextInput
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_RPS_LIMIT}
                value={form.targetRps}
                invalid={Boolean(errors.targetRps)}
                disabled={locked}
                onChange={(e) => patch('targetRps', e.target.value)}
              />
            </Field>
          </div>

          {/* Max RPS */}
          <div className="min-w-0">
            <Field
              label={t('settings.maxRpsCap')}
              error={errors.maxRps}
              hint={t('settings.maxRpsCapHint')}
            >
              <TextInput
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_RPS_LIMIT}
                value={form.maxRps}
                invalid={Boolean(errors.maxRps)}
                disabled={locked}
                onChange={(e) => patch('maxRps', e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* ---------- Advanced toggle ---------- */}
        <button
          type="button"
          onClick={onToggleAdvanced}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/2 px-4 py-3.5 text-left outline-none transition-colors hover:border-white/15 hover:bg-white/4 focus-visible:border-cyan-500/50"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <span className="text-sm font-medium text-white">{t('settings.advancedTitle')}</span>
            <Badge tone="slate">{t('settings.optionalBadge')}</Badge>
            {isCustom && <Badge tone="indigo">{t('settings.customBadge')}</Badge>}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
              advancedOpen && 'rotate-180',
            )}
          />
        </button>

        {/* ---------- Advanced content ---------- */}
        {advancedOpen && (
          <div className="zp-anim-fade-in space-y-7 rounded-xl border border-white/6 bg-black/25 p-4 sm:p-5">
            {!isCustom && (
              <p className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t('settings.weightsDefaultsHint', { pattern: form.pattern })}
                </span>
              </p>
            )}

            <WeightsEditor
              form={form}
              setForm={setForm}
              disabled={locked || !isCustom}
              error={errors.weights}
            />

            <div className="space-y-4 border-t border-white/6 pt-6">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400/90">
                  {t('settings.additionalOptions')}
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  {t('settings.additionalOptionsHint')}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
                <div className="min-w-0">
                  <Field
                    label={t('settings.ipPoolLegit')}
                    error={errors.ipPoolLegit}
                    hint={t('settings.ipPoolLegitHint')}
                  >
                    <TextInput
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={form.ipPoolLegit}
                      invalid={Boolean(errors.ipPoolLegit)}
                      disabled={locked}
                      onChange={(e) => patch('ipPoolLegit', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="min-w-0">
                  <Field
                    label={t('settings.ipPoolAttack')}
                    error={errors.ipPoolAttack}
                    hint={t('settings.ipPoolAttackHint')}
                  >
                    <TextInput
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={form.ipPoolAttack}
                      invalid={Boolean(errors.ipPoolAttack)}
                      disabled={locked}
                      onChange={(e) => patch('ipPoolAttack', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="min-w-0">
                  <Field
                    label={t('settings.seed')}
                    error={errors.seed}
                    hint={t('settings.seedHint')}
                  >
                    <TextInput
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder={t('settings.seedPlaceholder')}
                      value={form.seed}
                      invalid={Boolean(errors.seed)}
                      disabled={locked}
                      onChange={(e) => patch('seed', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="min-w-0">
                  <Field label={t('settings.aiAnomalyMode')}>
                    <SelectInput
                      value={form.aiMode}
                      disabled={locked}
                      onChange={(e) => patch('aiMode', e.target.value as AiMode)}
                    >
                      {AI_MODES.map((m) => (
                        <option key={m} value={m} className="bg-[#0b1224]">
                          {m}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>

                <div className="min-w-0">
                  <Field
                    label={t('settings.aiFixedScore')}
                    error={errors.aiFixedScore}
                    hint={t('settings.aiFixedScoreHint')}
                  >
                    <TextInput
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={1}
                      step={0.05}
                      value={form.aiFixedScore}
                      invalid={Boolean(errors.aiFixedScore)}
                      disabled={locked || form.aiMode !== 'fixed'}
                      onChange={(e) => patch('aiFixedScore', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="min-w-0">
                  <Field
                    label={t('settings.enableJaHeaders')}
                    hint={t('settings.enableJaHeadersHint')}
                  >
                    <div className="flex h-11 items-center gap-3">
                      <Toggle
                        checked={form.enableJaHeaders}
                        disabled={locked}
                        label={t('settings.enableJaHeaders')}
                        onChange={(v) => patch('enableJaHeaders', v)}
                      />
                      <span className="text-sm text-slate-300">
                        {form.enableJaHeaders ? t('settings.enabled') : t('settings.disabled')}
                      </span>
                    </div>
                  </Field>
                </div>

                <div className="min-w-0 sm:col-span-2 xl:col-span-3">
                  <Field
                    label={t('settings.preferPaths')}
                    error={errors.paths}
                    hint={t('settings.preferPathsHint')}
                  >
                    <TextInput
                      dir="ltr"
                      placeholder="/, /login, /api/health"
                      value={form.paths}
                      invalid={Boolean(errors.paths)}
                      disabled={locked}
                      onChange={(e) => patch('paths', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}