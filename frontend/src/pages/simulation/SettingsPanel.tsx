// frontend/src/pages/simulation/SettingsPanel.tsx
// ==================================================================
// Simulation Settings + Advanced Settings (مطوية افتراضيًا)
// ==================================================================

import type { Dispatch, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronDown, Info, RotateCcw, SlidersHorizontal } from 'lucide-react'

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
import type { AiMode, Intensity, PersonaKey, SimulationPattern } from '../../services/simulationsService'
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
  /** RUNNING: الإعدادات المؤثرة في الـ Run الحالي مقفولة */
  locked: boolean
  advancedOpen: boolean
  onToggleAdvanced: () => void
  onPatternChange: (pattern: SimulationPattern) => void
  onCustomize: () => void
  onReset: () => void
}

const INTENSITIES: Intensity[] = ['low', 'medium', 'high']
const AI_MODES: AiMode[] = ['auto', 'fixed', 'off']

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
  const total = weightsTotal(form.weights)

  const setWeight = (key: PersonaKey, raw: string) => {
    const n = raw.trim() === '' ? 0 : Math.round(Number(raw))
    const value = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
    setForm((f) => ({ ...f, weights: { ...f.weights, [key]: value } }))
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
          Persona weights
        </h4>
        <p className="text-xs text-slate-500">
          Total <span className="font-semibold tabular-nums text-slate-300">{total}</span> · weights (0–100) become
          percentages during the run
        </p>
      </div>

      <div className="space-y-2.5">
        {PERSONAS.map((p) => {
          const weight = form.weights[p.key]
          const pct = total > 0 ? Math.round((weight / total) * 100) : 0
          return (
            <div
              key={p.key}
              className="grid grid-cols-1 items-center gap-x-4 gap-y-2 rounded-xl border border-white/6 bg-white/2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
            >
              <div className="min-w-0">
                <p className="font-mono text-sm text-white">{p.key}</p>
                <p dir="auto" className="text-[11px] leading-relaxed text-slate-500">
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
                className="h-1.5 w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              />

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={weight}
                  disabled={disabled}
                  onChange={(e) => setWeight(p.key, e.target.value)}
                  aria-label={`${p.key} weight value`}
                  className="w-16 rounded-lg border border-white/10 bg-white/3 px-2 py-1.5 text-center text-sm tabular-nums text-white outline-none focus:border-cyan-500/50 disabled:opacity-50"
                />
                <span className="w-10 text-right text-xs tabular-nums text-slate-500">{pct}%</span>
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <p dir="auto" className="mt-2 text-xs text-rose-400">
          {error}
        </p>
      )}
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
  const selected = servers.find((s) => s.id === form.serverId)
  const hasOnline = servers.some((s) => s.status === 'ONLINE')
  const patternMeta = PATTERNS.find((p) => p.value === form.pattern)
  const isCustom = form.pattern === 'custom'

  const patch = <K extends keyof SimForm>(key: K, value: SimForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  return (
    <Card className="p-5 sm:p-6" delay={40} accent>
      {/* ---------- Title ---------- */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Simulation settings</h2>
          <p className="text-xs text-slate-500">Defaults are ready — you can start without opening Advanced Settings.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={SlidersHorizontal} disabled={locked} onClick={onCustomize}>
            Customize
          </Button>
          <Button size="sm" icon={RotateCcw} disabled={locked} onClick={onReset}>
            Reset to Defaults
          </Button>
        </div>
      </div>

      {/* ---------- Locked note ---------- */}
      {locked && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Settings are locked while a run is active. Changes only apply to a new run.</p>
        </div>
      )}

      {/* ---------- Form error (من الباك: 409 / 404 / 400) ---------- */}
      {formError && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p dir="auto">{formError}</p>
        </div>
      )}

      {/* ---------- No ONLINE server ---------- */}
      {!serversLoading && !serversError && !hasOnline && (
        <div className="mb-5 flex flex-wrap items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">
            {servers.length === 0
              ? 'No servers found. Add and verify a server first, then come back to run a simulation.'
              : 'No ONLINE server is available, so the simulation cannot start. Wait until a server comes online or check its status.'}{' '}
            <Link to="/servers" className="font-semibold underline underline-offset-2 hover:text-white">
              Open Servers
            </Link>
          </p>
        </div>
      )}

      {/* ---------- Core fields ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Server */}
        <Field label="Server" error={errors.serverId}>
          {serversLoading ? (
            <Skeleton className="h-10.5 w-full rounded-xl" />
          ) : serversError ? (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
              <span dir="auto" className="min-w-0 flex-1 truncate" title={serversError}>
                {serversError}
              </span>
              <button type="button" onClick={onRetryServers} className="shrink-0 font-semibold underline">
                Retry
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
                {servers.length === 0 ? 'No servers' : 'Select a server'}
              </option>
              {servers.map((s) => (
                <option key={s.id} value={s.id} disabled={s.status !== 'ONLINE'} className="bg-[#0b1224]">
                  {s.domain} — {s.status}
                </option>
              ))}
            </SelectInput>
          )}
          {selected?.mode === 'MONITOR_ONLY' && (
            <div className="mt-2 space-y-1.5">
              <Badge tone="amber" dot>
                MONITOR_ONLY
              </Badge>
              <p dir="auto" className="text-xs leading-relaxed text-amber-300/90">
                القرارات ستُسجّل، لكن المرور غالبًا سيُسمح به حسب السياسة.
              </p>
            </div>
          )}
        </Field>

        {/* Pattern */}
        <Field label="Pattern">
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
            <p dir="auto" className="text-xs text-slate-500">
              {patternMeta.description}
            </p>
          )}
        </Field>

        {/* Intensity */}
        <Field label="Intensity" hint="Controls the persona weights used in the simulation">
          <SelectInput
            value={form.intensity}
            disabled={locked}
            onChange={(e) => patch('intensity', e.target.value as Intensity)}
          >
            {INTENSITIES.map((i) => (
              <option key={i} value={i} className="bg-[#0b1224]">
                {i}
              </option>
            ))}
          </SelectInput>
        </Field>

        {/* Duration */}
        <Field
          label="Duration"
          error={errors.durationValue}
          hint={`Min ${MIN_DURATION_SEC} s · Max ${MAX_DURATION_SEC} s (or per plan)`}
        >
          <div className="flex gap-2">
            <TextInput
              type="number"
              inputMode="numeric"
              min={1}
              value={form.durationValue}
              invalid={Boolean(errors.durationValue)}
              disabled={locked}
              onChange={(e) => patch('durationValue', e.target.value)}
            />
            <SelectInput
              className="w-28 shrink-0"
              value={form.durationUnit}
              disabled={locked}
              onChange={(e) => patch('durationUnit', e.target.value as DurationUnit)}
              aria-label="Duration unit"
            >
              <option value="sec" className="bg-[#0b1224]">
                seconds
              </option>
              <option value="min" className="bg-[#0b1224]">
                minutes
              </option>
            </SelectInput>
          </div>
        </Field>

        {/* Target RPS */}
        <Field label="Target RPS" error={errors.targetRps} hint="Average target rate (the worker adds jitter)">
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

        {/* Max RPS */}
        <Field label="Max RPS Cap" error={errors.maxRps} hint="Safety ceiling for the request rate">
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

      {/* ---------- Advanced toggle ---------- */}
      <button
        type="button"
        onClick={onToggleAdvanced}
        aria-expanded={advancedOpen}
        className="mt-6 flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/2 px-4 py-3 text-left hover:border-white/15 hover:bg-white/4"
      >
        <span className="flex items-center gap-2.5">
          <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium text-white">Advanced settings</span>
          <Badge tone="slate">Optional</Badge>
          {isCustom && <Badge tone="indigo">custom</Badge>}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', advancedOpen && 'rotate-180')} />
      </button>

      {/* ---------- Advanced content ---------- */}
      {advancedOpen && (
        <div className="zp-anim-fade-in mt-4 space-y-6 rounded-xl border border-white/6 bg-black/20 p-4 sm:p-5">
          {!isCustom && (
            <p dir="auto" className="flex items-start gap-2 text-xs text-slate-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Weights shown here are the defaults of <span className="font-mono text-slate-300">{form.pattern}</span>. Use{' '}
              <span className="font-semibold text-slate-300">Customize</span> to edit them (switches the pattern to custom).
            </p>
          )}

          <WeightsEditor form={form} setForm={setForm} disabled={locked || !isCustom} error={errors.weights} />

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Additional options
            </h4>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="IP Pool Size (Legit)" error={errors.ipPoolLegit} hint="IPs used to simulate legitimate visitors">
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

              <Field label="IP Pool Size (Attack)" error={errors.ipPoolAttack} hint="IPs used to simulate attackers">
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

              <Field label="Seed" error={errors.seed} hint="Empty = random. Same settings + same seed = same distribution">
                <TextInput
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="Random"
                  value={form.seed}
                  invalid={Boolean(errors.seed)}
                  disabled={locked}
                  onChange={(e) => patch('seed', e.target.value)}
                />
              </Field>

              <Field label="AI Anomaly Mode">
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

              <Field label="AI Fixed Score" error={errors.aiFixedScore} hint="0 – 1 · used when AI mode is fixed">
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

              <Field label="Enable JA Headers" hint="Send JA3/JA4 when the worker and gateway support it">
                <div className="flex h-10.5 items-center gap-3">
                  <Toggle
                    checked={form.enableJaHeaders}
                    disabled={locked}
                    label="Enable JA headers"
                    onChange={(v) => patch('enableJaHeaders', v)}
                  />
                  <span className="text-sm text-slate-300">{form.enableJaHeaders ? 'Enabled' : 'Disabled'}</span>
                </div>
              </Field>

              <div className="sm:col-span-2 lg:col-span-3">
                <Field
                  label="Prefer Paths"
                  error={errors.paths}
                  hint="Comma separated, e.g. /, /login, /api/health (empty = backend defaults)"
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
    </Card>
  )
}