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
            Persona weights
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Weights (0–100) are converted to percentages during the run
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Total{' '}
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
  const selected = servers.find((s) => s.id === form.serverId)
  const hasOnline = servers.some((s) => s.status === 'ONLINE')
  const patternMeta = PATTERNS.find((p) => p.value === form.pattern)
  const isCustom = form.pattern === 'custom'

  const totalLabel = formatTotalDuration(form.durationValue, form.durationUnit)
  const durationHint = `Min ${MIN_DURATION_SEC}s · Max ${MAX_DURATION_SEC}s (or per plan)${
    totalLabel ? ` · = ${totalLabel}` : ''
  }`

  const patch = <K extends keyof SimForm>(key: K, value: SimForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  return (
    <Card className="overflow-hidden p-0" delay={40} accent>
      {/* ---------- Header ---------- */}
      <div className="flex flex-col gap-4 border-b border-white/6 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">Simulation settings</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Defaults are ready — you can start without opening Advanced Settings.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" icon={SlidersHorizontal} disabled={locked} onClick={onCustomize}>
            Customize
          </Button>
          <Button size="sm" icon={RotateCcw} disabled={locked} onClick={onReset}>
            Reset to Defaults
          </Button>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        {/* ---------- Locked note ---------- */}
        {locked && (
          <div className="flex items-start gap-3 rounded-xl border border-cyan-400/20 bg-cyan-500/6 px-4 py-3.5 text-sm text-cyan-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 leading-relaxed">
              Settings are locked while a run is active. Changes only apply to a new run.
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
                ? 'No servers found. Add and verify a server first, then come back to run a simulation.'
                : 'No ONLINE server is available, so the simulation cannot start. Wait until a server comes online or check its status.'}{' '}
              <Link
                to="/servers"
                className="font-semibold underline underline-offset-2 hover:text-white"
              >
                Open Servers
              </Link>
            </p>
          </div>
        )}

        {/* ---------- Core fields ---------- */}
        <div className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {/* Server */}
          <div className="min-w-0">
            <Field label="Server" error={errors.serverId}>
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
                    MONITOR_ONLY
                  </Badge>
                  <p className="text-xs leading-relaxed text-amber-300/90">
                    Decisions will be recorded, but traffic will mostly be allowed according
                    to policy.
                  </p>
                </div>
              )}
            </Field>
          </div>

          {/* Pattern */}
          <div className="min-w-0">
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
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  {patternMeta.description}
                </p>
              )}
            </Field>
          </div>

          {/* Intensity */}
          <div className="min-w-0">
            <Field
              label="Intensity"
              hint="Controls the persona weights used in the simulation"
            >
              <SelectInput
                value={form.intensity}
                disabled={locked}
                onChange={(e) => patch('intensity', e.target.value as Intensity)}
              >
                {INTENSITIES.map((i) => (
                  <option key={i} value={i} className="bg-[#0b1224]">
                    {i.charAt(0).toUpperCase() + i.slice(1)}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>

          {/* Duration — input takes the free space, unit select is auto width */}
          <div className="min-w-0">
            <Field label="Duration" error={errors.durationValue} hint={durationHint}>
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
              </div>
            </Field>
          </div>

          {/* Target RPS */}
          <div className="min-w-0">
            <Field
              label="Target RPS"
              error={errors.targetRps}
              hint="Average target rate (the worker adds jitter)"
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
              label="Max RPS Cap"
              error={errors.maxRps}
              hint="Safety ceiling for the request rate"
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
            <span className="text-sm font-medium text-white">Advanced settings</span>
            <Badge tone="slate">Optional</Badge>
            {isCustom && <Badge tone="indigo">custom</Badge>}
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
                  Weights shown here are the defaults of{' '}
                  <span className="font-mono text-slate-300">{form.pattern}</span>. Use{' '}
                  <span className="font-semibold text-slate-300">Customize</span> to edit
                  them (switches the pattern to custom).
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
                  Additional options
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  Optional overrides for IP pools, AI mode, seed and preferred paths
                </p>
              </div>

              <div className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
                <div className="min-w-0">
                  <Field
                    label="IP Pool Size (Legit)"
                    error={errors.ipPoolLegit}
                    hint="IPs used to simulate legitimate visitors"
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
                    label="IP Pool Size (Attack)"
                    error={errors.ipPoolAttack}
                    hint="IPs used to simulate attackers"
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
                    label="Seed"
                    error={errors.seed}
                    hint="Empty = random. Same settings + same seed = same distribution"
                  >
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
                </div>

                <div className="min-w-0">
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
                </div>

                <div className="min-w-0">
                  <Field
                    label="AI Fixed Score"
                    error={errors.aiFixedScore}
                    hint="0 – 1 · used when AI mode is fixed"
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
                    label="Enable JA Headers"
                    hint="Send JA3/JA4 when the worker and gateway support it"
                  >
                    <div className="flex h-11 items-center gap-3">
                      <Toggle
                        checked={form.enableJaHeaders}
                        disabled={locked}
                        label="Enable JA headers"
                        onChange={(v) => patch('enableJaHeaders', v)}
                      />
                      <span className="text-sm text-slate-300">
                        {form.enableJaHeaders ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </Field>
                </div>

                <div className="min-w-0 sm:col-span-2 xl:col-span-3">
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
      </div>
    </Card>
  )
}