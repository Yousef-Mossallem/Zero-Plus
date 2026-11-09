// frontend/src/pages/simulation/shared.ts
// ==================================================================
// Simulation Lab - الثوابت والـ Validation وبناء الـ Payload والـ Timeline
// ==================================================================

import i18n from '../../i18n'
import type { SecurityEvent } from '../../services/eventsService'
import type {
  AiMode,
  Intensity,
  PersonaKey,
  PersonaWeights,
  RunStatus,
  RunTotals,
  SimulationPattern,
  SimulationRun,
  StartSimulationInput,
  StartSimulationOptions,
} from '../../services/simulationsService'
import type { Tone } from '../../components/ui/kit'

// ------------------------------------------------------------------
// Limits (غيّرها هنا لو الـ Plan أو الباك اتغيّروا)
// ------------------------------------------------------------------

export const MIN_DURATION_SEC = 30
export const MAX_DURATION_SEC = 900 // أو حسب الـ Plan
export const MIN_RPS = 1
export const MAX_RPS_LIMIT = 500
export const MAX_IP_POOL = 1000
export const MAX_PATHS = 20
export const BUCKET_MS = 5000

/** الأدوار المسموح لها بتشغيل/إيقاف المحاكاة (زي إدارة السيرفرات) */
export const SIM_ROLES = ['OWNER', 'ADMIN']

// ------------------------------------------------------------------
// Patterns
// ------------------------------------------------------------------

export const PATTERNS: Array<{ value: SimulationPattern; readonly label: string; readonly description: string }> = [
  {
    value: 'realistic_mix',
    get label() { return i18n.t('simulation:patterns.realistic_mix.label', 'Realistic mix') },
    get description() { return i18n.t('simulation:patterns.realistic_mix.desc', 'Natural traffic blend with a small percentage of anomalous behavior. (Default)') },
  },
  {
    value: 'legit_only',
    get label() { return i18n.t('simulation:patterns.legit_only.label', 'Legitimate only') },
    get description() { return i18n.t('simulation:patterns.legit_only.desc', 'Only legitimate visitors with standard browsing patterns.') },
  },
  {
    value: 'login_focus',
    get label() { return i18n.t('simulation:patterns.login_focus.label', 'Login focus') },
    get description() { return i18n.t('simulation:patterns.login_focus.desc', 'Concentrated traffic on /login and sensitive authorization endpoints.') },
  },
  {
    value: 'rate_stress',
    get label() { return i18n.t('simulation:patterns.rate_stress.label', 'Rate stress') },
    get description() { return i18n.t('simulation:patterns.rate_stress.desc', 'High-volume traffic testing rate limit thresholds.') },
  },
  {
    value: 'bot_wave',
    get label() { return i18n.t('simulation:patterns.bot_wave.label', 'Bot wave') },
    get description() { return i18n.t('simulation:patterns.bot_wave.desc', 'Automated scraper signatures, headless browsers, and failed JS challenges.') },
  },
  {
    value: 'ban_recovery',
    get label() { return i18n.t('simulation:patterns.ban_recovery.label', 'Ban & recovery') },
    get description() { return i18n.t('simulation:patterns.ban_recovery.desc', 'Bursts of aggressive requests, trigger bans, and observe recovery.') },
  },
  {
    value: 'full_pipeline',
    get label() { return i18n.t('simulation:patterns.full_pipeline.label', 'Full pipeline') },
    get description() { return i18n.t('simulation:patterns.full_pipeline.desc', 'Sequential execution through all visitor personas.') },
  },
  {
    value: 'custom',
    get label() { return i18n.t('simulation:patterns.custom.label', 'Custom mix') },
    get description() { return i18n.t('simulation:patterns.custom.desc', 'Manually customized weights across individual personas.') },
  },
]

// ------------------------------------------------------------------
// Personas
// ------------------------------------------------------------------

export const PERSONAS: Array<{ key: PersonaKey; readonly description: string }> = [
  { key: 'legit_ok', get description() { return i18n.t('simulation:personas.legit_ok', 'Regular legitimate visitor') } },
  { key: 'legit_sensitive', get description() { return i18n.t('simulation:personas.legit_sensitive', 'Legitimate visitor accessing sensitive endpoints') } },
  { key: 'rate_soft', get description() { return i18n.t('simulation:personas.rate_soft', 'Traffic approaching soft rate limit') } },
  { key: 'rate_hard', get description() { return i18n.t('simulation:personas.rate_hard', 'Traffic breaching hard rate limit') } },
  { key: 'bot_ua', get description() { return i18n.t('simulation:personas.bot_ua', 'Scripted or automated crawler user agent') } },
  { key: 'fail_js', get description() { return i18n.t('simulation:personas.fail_js', 'Client failing silent JS challenge') } },
  { key: 'pass_js', get description() { return i18n.t('simulation:personas.pass_js', 'Client explicitly passing JS challenge') } },
  { key: 'bad_ip', get description() { return i18n.t('simulation:personas.bad_ip', 'Known malicious IP / high anomaly score') } },
]

const REALISTIC_MIX: PersonaWeights = {
  legit_ok: 45,
  legit_sensitive: 15,
  rate_soft: 10,
  rate_hard: 5,
  bot_ua: 8,
  fail_js: 7,
  pass_js: 5,
  bad_ip: 5,
}

/**
 * الأوزان المعروضة لكل Pattern.
 * realistic_mix = الديفولت المحدد في الـ Spec.
 * باقي الأنماط = قيم عرض تقريبية؛ الباك هو مصدر الحقيقة لما الـ options مش بتتبعت.
 */
export const DEFAULT_WEIGHTS: Record<SimulationPattern, PersonaWeights> = {
  realistic_mix: REALISTIC_MIX,
  legit_only: { legit_ok: 80, legit_sensitive: 20, rate_soft: 0, rate_hard: 0, bot_ua: 0, fail_js: 0, pass_js: 0, bad_ip: 0 },
  login_focus: { legit_ok: 15, legit_sensitive: 40, rate_soft: 10, rate_hard: 5, bot_ua: 10, fail_js: 10, pass_js: 5, bad_ip: 5 },
  rate_stress: { legit_ok: 15, legit_sensitive: 0, rate_soft: 40, rate_hard: 35, bot_ua: 5, fail_js: 0, pass_js: 0, bad_ip: 5 },
  bot_wave: { legit_ok: 15, legit_sensitive: 0, rate_soft: 0, rate_hard: 0, bot_ua: 45, fail_js: 25, pass_js: 5, bad_ip: 10 },
  ban_recovery: { legit_ok: 25, legit_sensitive: 0, rate_soft: 0, rate_hard: 40, bot_ua: 10, fail_js: 0, pass_js: 5, bad_ip: 20 },
  full_pipeline: { legit_ok: 10, legit_sensitive: 10, rate_soft: 10, rate_hard: 10, bot_ua: 10, fail_js: 10, pass_js: 10, bad_ip: 10 },
  custom: REALISTIC_MIX,
}

// ------------------------------------------------------------------
// Form state (كل الحقول Strings عشان المستخدم يقدر يمسح الحقل)
// ------------------------------------------------------------------

export type DurationUnit = 'sec' | 'min'

export interface SimForm {
  serverId: string
  pattern: SimulationPattern
  durationValue: string
  durationUnit: DurationUnit
  targetRps: string
  maxRps: string
  intensity: Intensity
  weights: PersonaWeights
  ipPoolLegit: string
  ipPoolAttack: string
  enableJaHeaders: boolean
  aiMode: AiMode
  aiFixedScore: string
  paths: string
  seed: string
}

/** ديفولتات كل حاجة ما عدا الـ Server */
export function defaultSettings(pattern: SimulationPattern = 'realistic_mix'): Omit<SimForm, 'serverId'> {
  return {
    pattern,
    durationValue: '120',
    durationUnit: 'sec',
    targetRps: '15',
    maxRps: '40',
    intensity: 'medium',
    weights: { ...DEFAULT_WEIGHTS[pattern] },
    ipPoolLegit: '12',
    ipPoolAttack: '40',
    enableJaHeaders: true,
    aiMode: 'auto',
    aiFixedScore: '0.35',
    paths: '',
    seed: '',
  }
}

export function defaultForm(serverId = ''): SimForm {
  return { serverId, ...defaultSettings('realistic_mix') }
}

export function durationToSec(form: Pick<SimForm, 'durationValue' | 'durationUnit'>): number {
  const n = Number(form.durationValue)
  return form.durationUnit === 'min' ? n * 60 : n
}

export function parsePaths(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function weightsTotal(weights: PersonaWeights): number {
  return Object.values(weights).reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0)
}

// ------------------------------------------------------------------
// Validation (قبل Start)
// ------------------------------------------------------------------

export type FormErrors = Partial<Record<
  | 'serverId'
  | 'durationValue'
  | 'targetRps'
  | 'maxRps'
  | 'weights'
  | 'ipPoolLegit'
  | 'ipPoolAttack'
  | 'aiFixedScore'
  | 'paths'
  | 'seed',
  string
>>

function isIntInRange(raw: string, min: number, max: number): boolean {
  if (raw.trim() === '') return false
  const n = Number(raw)
  return Number.isInteger(n) && n >= min && n <= max
}

export function validateForm(
  form: SimForm,
  onlineServerIds: string[],
  maxDurationSec: number = MAX_DURATION_SEC,
): FormErrors {
  const errors: FormErrors = {}

  if (!form.serverId || !onlineServerIds.includes(form.serverId)) {
    errors.serverId = 'Select a valid ONLINE server'
  }

  const dur = durationToSec(form)
  if (form.durationValue.trim() === '' || !Number.isFinite(dur) || !Number.isInteger(dur)) {
    errors.durationValue = 'Enter a whole number'
  } else if (dur < MIN_DURATION_SEC || dur > maxDurationSec) {
    errors.durationValue = `Duration must be between ${MIN_DURATION_SEC} and ${maxDurationSec} seconds`
  }

  if (!isIntInRange(form.targetRps, MIN_RPS, MAX_RPS_LIMIT)) {
    errors.targetRps = `Target RPS must be a whole number between ${MIN_RPS} and ${MAX_RPS_LIMIT}`
  }
  if (!isIntInRange(form.maxRps, MIN_RPS, MAX_RPS_LIMIT)) {
    errors.maxRps = `Max RPS must be a whole number between ${MIN_RPS} and ${MAX_RPS_LIMIT}`
  } else if (!errors.targetRps && Number(form.maxRps) < Number(form.targetRps)) {
    errors.maxRps = 'Max RPS cannot be lower than Target RPS'
  }

  if (form.pattern === 'custom') {
    const values = Object.values(form.weights)
    if (values.some((w) => !Number.isInteger(w) || w < 0 || w > 100)) {
      errors.weights = 'Each weight must be a whole number from 0 to 100'
    } else if (weightsTotal(form.weights) <= 0) {
      errors.weights = 'The sum of persona weights must be greater than zero'
    }
  }

  if (!isIntInRange(form.ipPoolLegit, 1, MAX_IP_POOL)) {
    errors.ipPoolLegit = `Enter a whole number between 1 and ${MAX_IP_POOL}`
  }
  if (!isIntInRange(form.ipPoolAttack, 1, MAX_IP_POOL)) {
    errors.ipPoolAttack = `Enter a whole number between 1 and ${MAX_IP_POOL}`
  }

  if (form.aiMode === 'fixed') {
    const n = Number(form.aiFixedScore)
    if (form.aiFixedScore.trim() === '' || !Number.isFinite(n) || n < 0 || n > 1) {
      errors.aiFixedScore = 'Score must be between 0 and 1'
    }
  }

  const paths = parsePaths(form.paths)
  if (paths.length > MAX_PATHS) {
    errors.paths = `Up to ${MAX_PATHS} paths are allowed`
  } else if (paths.some((p) => !p.startsWith('/'))) {
    errors.paths = 'Every path must start with /'
  }

  if (form.seed.trim() !== '' && !isIntInRange(form.seed, 0, 2_147_483_647)) {
    errors.seed = 'Seed must be a whole number (or leave it empty for random)'
  }

  return errors
}

// ------------------------------------------------------------------
// Payload: الـ options اختيارية. بنبعت بس اللي المستخدم غيّره عن الديفولت
// (في custom بنبعت الأوزان كما هي دائمًا) والباك يكمّل الباقي.
// ------------------------------------------------------------------

export function buildStartPayload(form: SimForm): StartSimulationInput {
  const base = defaultSettings(form.pattern === 'custom' ? 'realistic_mix' : form.pattern)
  const options: StartSimulationOptions = {}

  const weightsChanged = (Object.keys(form.weights) as PersonaKey[]).some(
    (k) => form.weights[k] !== base.weights[k],
  )
  if (form.pattern === 'custom' || weightsChanged) options.personaWeights = { ...form.weights }

  if (form.ipPoolLegit !== base.ipPoolLegit) options.ipPoolLegit = Number(form.ipPoolLegit)
  if (form.ipPoolAttack !== base.ipPoolAttack) options.ipPoolAttack = Number(form.ipPoolAttack)
  if (form.enableJaHeaders !== base.enableJaHeaders) options.enableJaHeaders = form.enableJaHeaders
  if (form.aiMode !== base.aiMode) options.aiMode = form.aiMode
  if (form.aiMode === 'fixed') options.aiFixedScore = Number(form.aiFixedScore)

  const paths = parsePaths(form.paths)
  if (paths.length > 0) options.paths = paths
  if (form.seed.trim() !== '') options.seed = Number(form.seed)

  const payload: StartSimulationInput = {
    serverId: form.serverId,
    pattern: form.pattern,
    durationSec: durationToSec(form),
    targetRps: Number(form.targetRps),
    maxRps: Number(form.maxRps),
    intensity: form.intensity,
  }
  if (Object.keys(options).length > 0) payload.options = options
  return payload
}

/** أخطاء الباك (400) → حقول الفورم */
export function mapBackendFieldErrors(fieldErrors: Record<string, string>): FormErrors {
  const out: FormErrors = {}
  for (const [field, message] of Object.entries(fieldErrors)) {
    if (field === 'serverId') out.serverId = message
    else if (field === 'durationSec') out.durationValue = message
    else if (field === 'targetRps') out.targetRps = message
    else if (field === 'maxRps') out.maxRps = message
    else if (field.startsWith('options.personaWeights')) out.weights = message
    else if (field === 'options.ipPoolLegit') out.ipPoolLegit = message
    else if (field === 'options.ipPoolAttack') out.ipPoolAttack = message
    else if (field === 'options.aiFixedScore') out.aiFixedScore = message
    else if (field.startsWith('options.paths')) out.paths = message
    else if (field === 'options.seed') out.seed = message
  }
  return out
}

// ------------------------------------------------------------------
// Status
// ------------------------------------------------------------------

export type DisplayStatus = 'IDLE' | RunStatus

export const STATUS_TONE: Record<DisplayStatus, Tone> = {
  IDLE: 'slate',
  RUNNING: 'cyan',
  STOPPED: 'amber',
  COMPLETED: 'emerald',
  FAILED: 'rose',
}

// ------------------------------------------------------------------
// Derived numbers (الأرقام الأساسية من الباك، ده عرض فقط)
// ------------------------------------------------------------------

export function blockedPercent(totals: Partial<RunTotals>): number | null {
  if (totals.sent === undefined || totals.blocked === undefined || totals.sent <= 0) return null
  return (totals.blocked / totals.sent) * 100
}

export function elapsedSec(run: SimulationRun, now: number): number | null {
  const start = Date.parse(run.startedAt)
  if (Number.isNaN(start)) return null
  if (run.status === 'RUNNING') return Math.max(0, (now - start) / 1000)
  if (run.stoppedAt) {
    const end = Date.parse(run.stoppedAt)
    if (!Number.isNaN(end)) return Math.max(0, (end - start) / 1000)
  }
  return null
}

export function progressPercent(run: SimulationRun, now: number): number | null {
  if (run.status === 'COMPLETED') return 100
  if (!run.durationSec || run.durationSec <= 0) return null
  const elapsed = elapsedSec(run, now)
  if (elapsed === null) return null
  return Math.min(100, Math.max(0, (elapsed / run.durationSec) * 100))
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function formatDuration(sec: number | null): string {
  if (sec === null) return '—'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return r === 0 ? `${m}m` : `${m}m ${String(r).padStart(2, '0')}s`
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

// ------------------------------------------------------------------
// RPS اللحظي (تقريبي من عداد Total Sent)
// ------------------------------------------------------------------

export interface Snapshot {
  ts: number
  totals: RunTotals
}

export function completeTotals(t: Partial<RunTotals>): RunTotals {
  return {
    sent: t.sent ?? 0,
    allowed: t.allowed ?? 0,
    challenged: t.challenged ?? 0,
    rateLimited: t.rateLimited ?? 0,
    blocked: t.blocked ?? 0,
  }
}

export function approxRps(snapshots: Snapshot[]): number | null {
  if (snapshots.length < 2) return null
  const last = snapshots[snapshots.length - 1]
  if (!last) return null
  const ref = snapshots.find((s) => s.ts < last.ts && last.ts - s.ts <= 6000)
  if (!ref) return null
  const dt = (last.ts - ref.ts) / 1000
  if (dt <= 0) return null
  return Math.max(0, (last.totals.sent - ref.totals.sent) / dt)
}

// ------------------------------------------------------------------
// Timeline (Time Buckets كل 5 ثواني)
// ------------------------------------------------------------------

export interface TimelinePoint {
  label: string
  allowed: number
  challenged: number
  rateLimited: number
  blocked: number
}

export interface TimelineResult {
  points: TimelinePoint[]
  source: 'live' | 'events' | 'none'
}

function bucketLabel(index: number): string {
  const sec = index * (BUCKET_MS / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function fromSnapshots(snapshots: Snapshot[], startMs: number): TimelinePoint[] {
  const lastPerBucket = new Map<number, RunTotals>()
  for (const s of snapshots) {
    const idx = Math.max(0, Math.floor((s.ts - startMs) / BUCKET_MS))
    lastPerBucket.set(idx, s.totals)
  }
  const indexes = [...lastPerBucket.keys()].sort((a, b) => a - b)
  let prev: RunTotals = { sent: 0, allowed: 0, challenged: 0, rateLimited: 0, blocked: 0 }
  const points: TimelinePoint[] = []
  for (const idx of indexes) {
    const cur = lastPerBucket.get(idx)
    if (!cur) continue
    points.push({
      label: bucketLabel(idx),
      allowed: Math.max(0, cur.allowed - prev.allowed),
      challenged: Math.max(0, cur.challenged - prev.challenged),
      rateLimited: Math.max(0, cur.rateLimited - prev.rateLimited),
      blocked: Math.max(0, cur.blocked - prev.blocked),
    })
    prev = cur
  }
  return points
}

function fromEvents(events: SecurityEvent[], startMs: number): TimelinePoint[] {
  const buckets = new Map<number, TimelinePoint>()
  for (const e of events) {
    const t = Date.parse(e.createdAt)
    if (Number.isNaN(t)) continue
    const idx = Math.max(0, Math.floor((t - startMs) / BUCKET_MS))
    const point =
      buckets.get(idx) ?? { label: bucketLabel(idx), allowed: 0, challenged: 0, rateLimited: 0, blocked: 0 }
    if (e.decision === 'ALLOW') point.allowed += 1
    else if (e.decision === 'CHALLENGE') point.challenged += 1
    else if (e.decision === 'RATE_LIMIT') point.rateLimited += 1
    else if (e.decision === 'BLOCK') point.blocked += 1
    buckets.set(idx, point)
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)
}

/**
 * - Live: لقطات العدادات اللي اتسجلت أثناء المتابعة (لو بدأت من أول الـ Run).
 * - غير كده (Run قديم / فتحت الصفحة في نص الـ Run): من الأحداث المتاحة.
 */
export function buildTimeline(
  run: SimulationRun | null,
  snapshots: Snapshot[],
  events: SecurityEvent[],
): TimelineResult {
  if (!run) return { points: [], source: 'none' }
  const startMs = Date.parse(run.startedAt)
  if (Number.isNaN(startMs)) return { points: [], source: 'none' }

  const first = snapshots[0]
  if (first && snapshots.length >= 2 && first.ts - startMs <= 10_000) {
    const points = fromSnapshots(snapshots, startMs)
    if (points.length > 0) return { points, source: 'live' }
  }

  const points = fromEvents(events, startMs)
  return points.length > 0 ? { points, source: 'events' } : { points: [], source: 'none' }
}